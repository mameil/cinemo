/**
 * 인스타그램 로컬 수집기 — Apify 대체 (C안, 2026-08-07)
 *
 * 원리: Apify가 팔던 건 지능이 아니라 IP다. GitHub Actions(데이터센터 IP)는
 * 인스타가 차단하지만, 집 맥(주거용 IP)에선 로그인 없이도
 *   프로필 그리드(최신 12개 링크) + 게시물 og 태그(캡션 전문·이미지·날짜)
 * 가 전부 나온다 (2026-08-07 3계정 실측). launchd로 매일 밤 로컬 실행한다.
 *
 * 출력은 Apify와 동일한 ApifyPost 모양 — dedup(raw_posts)·Gemini 파싱·R2 복사
 * 파이프라인을 그대로 재사용한다. 특히 id는 shortCode를 base64 디코드한
 * 인스타 media ID로, Apify가 주던 숫자 id와 정확히 일치한다(중복 적재 방지 실증).
 *
 * 한계 (Apify 대비):
 *   - 캐러셀: DOM에 보이는 이미지만 수집 (보통 1~2장). 캡션 전문이 있어
 *     시간표 파싱엔 충분하지만, 뒷장 이미지가 필요한 딥 시드는 Apify 사용.
 *   - timestamp: og:description의 날짜(일 단위)만 — 시각 정보 없음.
 *   - 인스타가 익명 접근을 조이면 언제든 깨질 수 있음 → 전 계정 0건이면 throw
 *     (fail-loud). 그날은 Apify 폴백(workflow_dispatch)으로.
 */

import type { ApifyPost } from "./collect";

const CHROME_DEFAULT =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

/** 게시물 간 대기 (봇 탐지 완화 — 무로그인 저속 원칙, 2~4초) */
function pace(): Promise<void> {
  return new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
}

/** 인스타 shortCode(base64url) → 숫자 media ID (Apify id와 동일 포맷) */
const SC_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function shortCodeToMediaId(shortCode: string): string {
  let n = 0n;
  for (const c of shortCode) {
    const v = SC_ALPHABET.indexOf(c);
    if (v < 0) return shortCode; // 예상 밖 문자 — shortCode 자체를 id로 (dedup은 유지됨)
    n = n * 64n + BigInt(v);
  }
  return n.toString();
}

/**
 * og:description에서 캡션 전문과 게시 날짜를 추출.
 * 형식: `152 likes, 0 comments - laikacinema - July 30, 2026: "캡션..."`
 * (실측 1,448자 — 긴 시간표 캡션도 전문이 담긴다)
 */
export function parseOgDescription(desc: string): {
  caption: string;
  timestamp?: string;
} {
  const m = desc.match(/^[^:"]* - ([A-Z][a-z]+ \d{1,2}, \d{4}): "([\s\S]*)"$/);
  if (m) {
    const d = new Date(`${m[1]} UTC`);
    return {
      caption: m[2],
      timestamp: isNaN(d.getTime()) ? undefined : d.toISOString(),
    };
  }
  // 형식이 바뀌면 통짜로라도 살린다 — Gemini는 잡음 섞인 캡션도 소화한다
  return { caption: desc };
}

interface PostPageData {
  ogImage: string | null;
  ogDescription: string | null;
  carouselImages: string[];
  loginWall: boolean;
}

/**
 * Apify `instagram-post-scraper`와 동일 시그니처의 로컬 수집.
 * 계정별 프로필 그리드에서 최신 limit개 링크 → 게시물 og 태그 수집.
 */
export async function fetchPostsLocal(
  handles: string[],
  limit: number
): Promise<ApifyPost[]> {
  // puppeteer-core는 로컬 전용 의존성 — CI(Apify 경로)에선 import되지 않게 지연 로드
  const { default: puppeteer } = await import("puppeteer-core");
  const chromePath = process.env.CHROME_BIN || CHROME_DEFAULT;

  const browser = await puppeteer.launch({
    headless: true, // launchd 무창 실행 — UA 오버라이드로 HeadlessChrome 표기 제거 (실측 통과)
    executablePath: chromePath,
    args: ["--no-sandbox", "--disable-gpu"],
  });

  const posts: ApifyPost[] = [];
  let emptyAccounts = 0;

  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    // tsx(esbuild)는 keep-names로 함수에 `__name` 헬퍼 호출을 주입하는데, page.evaluate로
    // 브라우저에 넘어간 함수 안에서 그 헬퍼가 없어 `__name is not defined`가 난다.
    // 모든 문서에 no-op __name을 먼저 심어 무력화한다 (문자열이라 esbuild가 안 건드림).
    await page.evaluateOnNewDocument(
      "globalThis.__name = globalThis.__name || function (f) { return f; };"
    );

    for (const handle of handles) {
      try {
        // ① 프로필 그리드 — 최신 게시물 링크 (고정 게시물 포함, Apify와 동일 순서)
        await page.goto(`https://www.instagram.com/${handle}/`, {
          waitUntil: "networkidle2",
          timeout: 40_000,
        });
        await pace();
        const links: string[] = await page.evaluate(() =>
          [
            ...document.querySelectorAll<HTMLAnchorElement>(
              'a[href*="/p/"], a[href*="/reel/"]'
            ),
          ].map((a) => a.href)
        );
        const targets = [...new Set(links)].slice(0, limit);
        if (!targets.length) {
          emptyAccounts++;
          console.warn(`  ⚠️ [로컬] @${handle} 게시물 링크 0개 (로그인월/차단 가능성)`);
          continue;
        }

        // ② 게시물별 og 태그
        for (const url of targets) {
          const shortCode = url.match(/\/(?:p|reel)\/([^/]+)/)?.[1];
          if (!shortCode) continue;
          try {
            await page.goto(url, { waitUntil: "networkidle2", timeout: 40_000 });
            await pace();
            const data: PostPageData = await page.evaluate(() => {
              const og = (n: string) =>
                document
                  .querySelector<HTMLMetaElement>(`meta[property="${n}"]`)
                  ?.content ?? null;
              // 캐러셀: DOM에 로드된 본문 이미지 (srcset 최고 해상도)
              const imgs = [
                ...document.querySelectorAll<HTMLImageElement>(
                  'article img[src*="scontent"], main img[src*="scontent"]'
                ),
              ]
                .filter((i) => /\/t51[.-]/.test(i.src)) // 본문 미디어만 (프로필 아바타 제외)
                .map((i) => {
                  const cands = (i.srcset || "")
                    .split(",")
                    .map((s) => s.trim().split(" ")[0])
                    .filter(Boolean);
                  return cands[cands.length - 1] || i.src;
                });
              return {
                ogImage: og("og:image"),
                ogDescription: og("og:description"),
                carouselImages: [...new Set(imgs)],
                loginWall: !!document.querySelector('input[name="username"]'),
              };
            });

            if (!data.ogImage && !data.ogDescription) {
              console.warn(`  ⚠️ [로컬] ${url} og 태그 없음${data.loginWall ? " (로그인월)" : ""} — 스킵`);
              continue;
            }

            const { caption, timestamp } = parseOgDescription(
              data.ogDescription ?? ""
            );
            const images = [
              ...new Set(
                [data.ogImage, ...data.carouselImages].filter(
                  (u): u is string => !!u
                )
              ),
            ];
            posts.push({
              id: shortCodeToMediaId(shortCode),
              shortCode,
              caption,
              images,
              displayUrl: data.ogImage ?? images[0],
              timestamp,
              ownerUsername: handle,
              url: `https://www.instagram.com/p/${shortCode}/`,
            });
          } catch (err) {
            console.warn(
              `  ⚠️ [로컬] 게시물 실패 ${url}: ${(err as Error).message.slice(0, 80)}`
            );
          }
        }
      } catch (err) {
        emptyAccounts++;
        console.warn(
          `  ⚠️ [로컬] @${handle} 프로필 실패: ${(err as Error).message.slice(0, 80)}`
        );
      }
    }
  } finally {
    await browser.close();
  }

  // fail-loud: 전 계정이 비면 인스타 익명 정책 변경 신호 — 조용히 0건 적재하지 않는다
  if (handles.length > 0 && posts.length === 0) {
    throw new Error(
      `로컬 인스타 수집 전멸 (${handles.length}계정 중 실패 ${emptyAccounts}) — ` +
        `익명 접근 차단 가능성. Apify 폴백(workflow_dispatch --max=2)을 사용할 것`
    );
  }
  return posts;
}
