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

import { existsSync } from "fs";
import type { ApifyPost } from "./collect";

/**
 * 시스템 Chrome 실행 파일 경로 (OS 자동 감지).
 * env CHROME_BIN 이 있으면 우선. 맥/윈도우 표준 설치 경로를 순서대로 탐색한다.
 * (집=맥 · 회사=윈도우 데스크탑 교대 사용 대비 — docs/insta-local-setup.md)
 */
function resolveChrome(): string {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return candidates.find((p) => p && existsSync(p)) ?? candidates[0];
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

/** 게시물 간 대기 (봇 탐지 완화 — 무로그인 저속 원칙, 4~8초) */
function pace(): Promise<void> {
  return new Promise((r) => setTimeout(r, 4000 + Math.random() * 4000));
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
 *
 * seenIds(기처리 media ID Set)를 주면 그리드 링크 단계에서 이미 본 게시물의
 * 상세 페이지를 아예 열지 않는다 — 시간별 폴링에서 새 게시물이 없는 대부분의
 * 실행이 프로필 그리드만 보고 끝나 요청 수·차단 위험을 크게 줄인다.
 * (파싱 실패로 raw_posts에 없는 게시물은 seenIds에 없으니 다음 실행에서 재시도됨)
 */
export async function fetchPostsLocal(
  handles: string[],
  limit: number,
  seenIds?: Set<string>
): Promise<ApifyPost[]> {
  // puppeteer-core는 로컬 전용 의존성 — CI(Apify 경로)에선 import되지 않게 지연 로드
  const { default: puppeteer } = await import("puppeteer-core");
  const chromePath = resolveChrome();

  // 절전 복귀 직후·부하 시 Chrome 기동이 느려 "WS endpoint ... Timed out 30000ms"가 나므로
  // 타임아웃을 늘리고(30→60s) 1회 재시도한다 (2026-08-08 집맥 error 대응).
  const launchOpts = {
    headless: true as const, // 무창 실행(launchd/작업 스케줄러) — UA 오버라이드로 HeadlessChrome 표기 제거
    executablePath: chromePath,
    args: ["--no-sandbox", "--disable-gpu"],
    timeout: 60_000,
    protocolTimeout: 120_000,
  };
  let browser;
  try {
    browser = await puppeteer.launch(launchOpts);
  } catch (e) {
    console.warn(`  ⚠️ [로컬] Chrome 기동 실패 1회 — 3초 후 재시도: ${(e as Error).message.slice(0, 80)}`);
    await new Promise((r) => setTimeout(r, 3000));
    browser = await puppeteer.launch(launchOpts);
  }

  const posts: ApifyPost[] = [];
  let emptyAccounts = 0;
  let skippedSeen = 0;

  try {
    for (const handle of handles) {
      // 계정마다 새 incognito context로 조회 — 인스타의 "같은 세션 2번째 프로필부터
      // 로그인월(빈 그리드)" 현상을 우회한다 (2026-08-09 진단: 1계정만 되고 2계정부터 막힘).
      const ctx = await browser.createBrowserContext();
      try {
        const page = await ctx.newPage();
        await page.setUserAgent(UA);
        // tsx(esbuild) keep-names가 주입한 __name이 page.evaluate에서 미정의 → 문서마다 no-op 선주입.
        await page.evaluateOnNewDocument(
          "globalThis.__name = globalThis.__name || function (f) { return f; };"
        );
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
          // 조기 중단: 아직 아무것도 못 걷었는데 연속 3계정이 비면 IP 차단으로 보고 중단한다.
          // 나머지 계정을 더 긁어 차단을 악화시키지 않기 위함 (2026-08-09).
          if (posts.length === 0 && emptyAccounts >= 3) {
            console.warn(`  ⛔ [로컬] 연속 ${emptyAccounts}계정 차단 감지 — 남은 계정 스킵(조기 중단)`);
            break;
          }
          continue;
        }

        // ② 게시물별 og 태그
        for (const url of targets) {
          const shortCode = url.match(/\/(?:p|reel)\/([^/]+)/)?.[1];
          if (!shortCode) continue;
          // 그리드 단계 dedup — 이미 본 게시물이면 상세 페이지를 열지 않는다
          if (seenIds?.has(shortCodeToMediaId(shortCode))) {
            skippedSeen++;
            continue;
          }
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
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (skippedSeen > 0) {
    console.log(`  [로컬] 기처리 ${skippedSeen}건 그리드 단계 스킵 (상세 미조회)`);
  }

  // fail-loud: "새 게시물이 없어 0건"(정상)과 "차단당해 0건"(사고)을 구분한다.
  // 그리드 링크를 준 계정이 하나도 없으면(=전 계정 프로필 접근 실패) 익명 차단 신호로 보고 throw.
  // 그리드는 읽혔는데 전부 기처리라 posts가 비는 건 정상 — 그대로 빈 배열 반환.
  if (handles.length > 0 && emptyAccounts === handles.length) {
    throw new Error(
      `로컬 인스타 수집 — 전 계정(${handles.length}) 프로필 접근 실패. ` +
        `익명 접근 차단 가능성. Apify 폴백(workflow_dispatch --max=2)을 사용할 것`
    );
  }
  return posts;
}
