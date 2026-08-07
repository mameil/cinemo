/**
 * 인스타그램 → 정규화(collect) — 독립영화관 게시물 전체 (설계서 2026-07-22, 07-22 확장)
 *
 * 방침: 특전이 아니어도 **모든 게시물을 이벤트로 수집** (특전은 부가 속성).
 * 체인 쪽 "특전만 → 이벤트 피드" 확장과 동일한 사상.
 *
 *   ① Apify instagram-post-scraper (계정당 최근 N개)
 *   ② dedup — raw_posts(source=INSTA, 게시물 ID)
 *   ③ Gemini 비전 파싱 (분류/요약/굿즈/기간/confidence)
 *   ④ 이미지 R2 복사 (전 게시물 — CDN URL 만료 대응)
 *   ⑤ CollectedEvent(chain=INDIE, category=파서 분류)
 *      — 특전(conf≥0.8)만 goodies + goods_stock '보유' 행 (진행 극장 연결)
 *   ⑥ raw_posts에 전부 보관 (dedup 마커 + 아카이브)
 */

import type { CollectedEvent, CollectedScreening } from "../domain";
import { existsRaw, saveRaw, getKnownSourceIds } from "../db/repo";
import { copyImageToR2 } from "../lib/r2";
import { assertApifyBudget } from "../lib/budget-guard";
import { getParser, type ParsedGoodiePost } from "./parse";
import { parseTimetable, noteToFormat } from "./timetable";
import { INSTA_ACCOUNTS, type InstaAccount } from "./accounts";

const CONFIDENCE_THRESHOLD = 0.8;
/** 시간표 추출 채택 최소 확신도 */
const TIMETABLE_CONFIDENCE = 0.7;
/** 종료일 미명시 시 시작일 + N일로 가정 (독립관 특전은 보통 "소진 시까지") */
const DEFAULT_DURATION_DAYS = 30;

export interface InstaCollectOptions {
  /** 계정당 최근 게시물 수 (기본 5) */
  maxPosts?: number;
  /** true면 DB 기록(dedup 마커 포함)·R2 업로드 없이 파싱 결과만 출력 */
  dry?: boolean;
  /**
   * 시드 모드: 계정 활성화 시 과거 게시물을 깊게 아카이브(raw_posts + 파싱)만 한다.
   * 이벤트·R2는 만들지 않음 — 끝난 특전이 피드에 '보유'로 뜨는 오염 방지.
   * 아카이브는 동명 영화 판별(감독/연도 역참조)의 1차 소스가 된다.
   */
  seed?: boolean;
  /**
   * 대상 계정 핸들 제한 (미지정 시 enabled 전체).
   * 계정별 시드용 — 12계정 일괄 시드는 Apify run-sync 300초 한도를 초과한다.
   */
  only?: string[];
  /**
   * 수집 경로 (기본 apify). "local"은 집 맥의 Chrome으로 무로그인 수집 —
   * Apify 크레딧 소모 없음 (launchd 데일리용, local-fetch.ts 참조).
   * env INSTA_FETCHER=local 로도 지정 가능.
   */
  fetcher?: "apify" | "local";
}

export interface ApifyPost {
  id: string;
  shortCode?: string;
  caption?: string;
  images?: string[];
  displayUrl?: string;
  timestamp?: string;
  ownerUsername?: string;
  url?: string;
}

export async function fetchPosts(handles: string[], limit: number): Promise<ApifyPost[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN 환경변수 누락");
  const res = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-post-scraper/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: handles, resultsLimit: limit }),
      signal: AbortSignal.timeout(280_000), // run-sync 한도(300s) 이내
    }
  );
  if (!res.ok) throw new Error(`Apify HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as ApifyPost[];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function buildEvent(
  post: ApifyPost,
  parsed: ParsedGoodiePost,
  account: InstaAccount,
  r2Urls: string[],
  withGoodies: boolean
): CollectedEvent {
  const postDate = (post.timestamp ?? new Date().toISOString()).slice(0, 10);
  const startDate = parsed.startDate ?? postDate;
  const endDate = parsed.endDate ?? addDays(startDate, DEFAULT_DURATION_DAYS);
  const summary = parsed.summary || (post.caption ?? "").split("\n")[0].slice(0, 40) || "게시물";

  return {
    chain: "INDIE",
    sourceEventId: `ig-${post.id}`,
    eventName: `[${account.theaterName}] ${summary}`,
    startDate,
    endDate,
    sourceUrl: post.url ?? (post.shortCode ? `https://www.instagram.com/p/${post.shortCode}/` : undefined),
    imageUrl: r2Urls[0],
    detailImageUrls: r2Urls.length ? r2Urls : undefined,
    category: withGoodies ? "특전" : parsed.category || "기타",
    movieTitle: parsed.movieTitle ?? undefined,
    // 특전이 아닌 일반 소식은 기존 영화에만 연결 (비영화 제목 오염 방지 — 체인 일반 이벤트와 동일)
    linkMovieOnly: !withGoodies,
    goodies: withGoodies
      ? parsed.goodies.map((g, i) => ({
          name: g.name,
          sourceGoodsId: `ig-${post.id}-${i}`,
          // 진행 극장 연결 — 재고는 미상이라 '보유' + 수량 null (메가박스와 동일 의미)
          stock: [{
            branchCode: `ig-${account.handle}`,
            branchName: account.theaterName,
            region: account.region,
            status: "보유" as const,
          }],
        }))
      : [],
    raw: { post, parsed, conditions: parsed.conditions },
  };
}

/**
 * 한 게시물에 여러 영화의 특전이 함께 안내되면 영화별 이벤트로 분리한다.
 * events.movie_id가 단일 값인 현재 스키마에서도 각 상영작에 특전 배지가 붙도록 한다.
 */
export function buildEvents(
  post: ApifyPost,
  parsed: ParsedGoodiePost,
  account: InstaAccount,
  r2Urls: string[],
  withGoodies: boolean
): CollectedEvent[] {
  if (!withGoodies || parsed.movieTitle || parsed.goodies.length < 2) {
    return [buildEvent(post, parsed, account, r2Urls, withGoodies)];
  }

  const split = parsed.goodies.flatMap((goodie, index) => {
    const suffix = goodie.type?.trim() || "포스터|엽서|스티커|티켓북|뱃지|기타";
    const movieTitle = goodie.name
      .replace(new RegExp(`\\s+(?:A\\d\\s*)?(?:${suffix})\\s*$`, "i"), "")
      .trim();
    if (!movieTitle || movieTitle === goodie.name.trim()) return [];
    const event = buildEvent(
      post,
      { ...parsed, movieTitle, goodies: [goodie] },
      account,
      r2Urls,
      true
    );
    const posterImage = r2Urls[index + 1];
    if (posterImage) {
      event.imageUrl = posterImage;
      event.detailImageUrls = [posterImage];
      event.goodies[0].imageUrl = posterImage;
    }
    event.sourceEventId = `ig-${post.id}-movie-${index}`;
    event.eventName = `[${account.theaterName}] ${movieTitle} ${goodie.type} 증정`;
    return [event];
  });
  return split.length >= 2 ? split : [buildEvent(post, parsed, account, r2Urls, withGoodies)];
}

/** 시간표 게시물 → CollectedScreening[] (극장 분류 게시물만 2차 호출) */
async function extractScreenings(
  post: ApifyPost,
  account: InstaAccount,
  imageUrls: string[]
): Promise<CollectedScreening[]> {
  const tt = await parseTimetable({ imageUrls, caption: post.caption ?? "" });
  if (!tt.isTimetable || tt.confidence < TIMETABLE_CONFIDENCE) return [];
  return tt.screenings.map((s) => ({
    chain: "INDIE" as const,
    branchCode: `ig-${account.handle}`,
    branchName: account.theaterName,
    region: account.region,
    movieTitle: s.movieTitle,
    playDate: s.date,
    startTime: s.time,
    screenName: "상영관", // 이미지에 관 구분이 없어 단일 표기
    format: noteToFormat(s.note),
    bookingUrl: post.url ?? (post.shortCode ? `https://www.instagram.com/p/${post.shortCode}/` : undefined),
  }));
}

export interface InstaCollectResult {
  events: CollectedEvent[];
  screenings: CollectedScreening[];
}

/** 인스타 공지를 정규화된 이벤트 + 상영 회차로 수집 */
export async function collectInsta(opts: InstaCollectOptions = {}): Promise<InstaCollectResult> {
  // 과금 방어: 게시물 수 하드캡(일상 100 / 시드 200) + Apify 크레딧 사전 점검 (80% 초과 시 중단)
  const limit = Math.min(opts.maxPosts ?? 5, opts.seed ? 200 : 100);
  const fetcher =
    opts.fetcher ?? (process.env.INSTA_FETCHER === "local" ? "local" : "apify");
  if (fetcher === "apify") await assertApifyBudget(); // 로컬 수집은 Apify 크레딧 미사용
  const onlySet = opts.only?.length ? new Set(opts.only.map((h) => h.toLowerCase())) : null;
  const accounts = INSTA_ACCOUNTS.filter(
    (a) => a.enabled && (!onlySet || onlySet.has(a.handle.toLowerCase()))
  );
  if (!accounts.length) {
    console.log("  활성화된 인스타 계정 없음" + (onlySet ? " (--only 매치 없음)" : ""));
    return { events: [], screenings: [] };
  }
  const byHandle = new Map(accounts.map((a) => [a.handle.toLowerCase(), a]));

  console.log(
    `  대상 ${accounts.length}계정 × 최근 ${limit}개 (${fetcher === "local" ? "로컬 Chrome" : "Apify"})`
  );
  // 로컬 수집은 그리드 단계 dedup으로 기처리 게시물의 상세 조회를 건너뛴다(시간별 폴링 대비).
  // dry는 결과를 다 보여줘야 하므로 seenIds 미적용. 시드는 과거 아카이브가 목적이라 역시 미적용.
  const seenIds =
    fetcher === "local" && !opts.dry && !opts.seed
      ? await getKnownSourceIds("INSTA")
      : undefined;
  const posts =
    fetcher === "local"
      ? await (await import("./local-fetch")).fetchPostsLocal(
          accounts.map((a) => a.handle),
          limit,
          seenIds
        )
      : await fetchPosts(accounts.map((a) => a.handle), limit);
  console.log(`  게시물 ${posts.length}건 수신`);

  const parser = getParser();
  const result: CollectedEvent[] = [];
  const allScreenings: CollectedScreening[] = [];
  let skippedOld = 0;
  let notGoodie = 0;
  let lowConf = 0;

  for (const post of posts) {
    if (!post.id) continue;
    const account = byHandle.get((post.ownerUsername ?? "").toLowerCase());
    if (!account) continue;

    // ② dedup — 이미 처리한 게시물
    if (!opts.dry && (await existsRaw("INSTA", post.id))) {
      skippedOld++;
      continue;
    }

    const cdnImages = post.images?.length ? post.images : post.displayUrl ? [post.displayUrl] : [];
    if (!cdnImages.length) continue;

    // ③ 파싱 (원본 CDN URL로 — 만료 전 신선한 상태)
    // Gemini 무료 티어 분당 제한(20 RPM) 준수 — 게시물 간 간격.
    // 시드(대량)는 여유 있게 10초 — 3.5초(분당 ~17회)로는 경계에서 429 연발했음 (2026-07-25)
    await new Promise((r) => setTimeout(r, opts.seed ? 10_000 : 3500));
    let parsed: ParsedGoodiePost;
    try {
      parsed = await parser.parse({ imageUrls: cdnImages, caption: post.caption ?? "" });
    } catch (err) {
      console.error(`  ⚠️ 파싱 실패 [${account.theaterName} ${post.id}]: ${(err as Error).message.slice(0, 100)}`);
      continue; // dedup 마커 없이 넘어감 → 다음 크론에서 재시도
    }

    // 특전으로 인정 = 증정 공지 + 확신도 충족 (미달 시 일반 게시물로 수집, 굿즈 미부착)
    const withGoodies = parsed.isGoodieEvent && parsed.confidence >= CONFIDENCE_THRESHOLD;
    if (parsed.isGoodieEvent && !withGoodies) lowConf++;
    if (!parsed.isGoodieEvent) notGoodie++;

    // 시드 모드: 아카이브만 (이벤트·시간표·R2 생략)
    if (opts.seed) {
      if (!opts.dry) await saveRaw("INSTA", post.id, { post, parsed });
      console.log(
        `  [seed] ${account.theaterName} → [${parsed.category}] ${parsed.summary}` +
          `${parsed.movieTitle ? ` | ${parsed.movieTitle}` : ""}` +
          `${parsed.director ? ` | 감독 ${parsed.director}` : ""}${parsed.year ? ` | ${parsed.year}` : ""}`
      );
      continue;
    }

    // 극장 소식(시간표류)이면 시간표 2차 추출 → 홈 시간표 합류
    let postScreenings: CollectedScreening[] = [];
    if (parsed.category === "극장") {
      try {
        postScreenings = await extractScreenings(post, account, cdnImages);
        if (postScreenings.length) {
          console.log(`  🎞️ 시간표 추출 [${account.theaterName}] ${postScreenings.length}회차`);
        }
      } catch (err) {
        console.error(`  ⚠️ 시간표 추출 실패 [${post.id}]: ${(err as Error).message.slice(0, 100)}`);
      }
    }

    if (opts.dry) {
      console.log(
        `  [dry] ${account.theaterName} → [${withGoodies ? "특전" : parsed.category}] ${parsed.summary}` +
          ` (conf ${parsed.confidence})${parsed.goodies.length ? " 굿즈: " + parsed.goodies.map((g) => g.name).join(",") : ""}`
      );
      result.push(...buildEvents(post, parsed, account, cdnImages, withGoodies));
      allScreenings.push(...postScreenings);
      continue;
    }

    // ⑥ 아카이브 + dedup 마커
    await saveRaw("INSTA", post.id, { post, parsed });

    // ④ 이미지 R2 복사 (전 게시물 — 피드 노출용)
    const r2Urls: string[] = [];
    const imageLimit = withGoodies && !parsed.movieTitle && parsed.goodies.length > 1 ? 10 : 3;
    for (let i = 0; i < Math.min(cdnImages.length, imageLimit); i++) {
      try {
        r2Urls.push(await copyImageToR2(cdnImages[i], `insta/${account.handle}/${post.id}_${i}.jpg`));
      } catch (err) {
        console.error(`  ⚠️ R2 복사 실패 [${post.id}_${i}]: ${(err as Error).message.slice(0, 80)}`);
      }
    }

    result.push(...buildEvents(post, parsed, account, r2Urls, withGoodies));
    allScreenings.push(...postScreenings);
  }

  const goodieCount = result.filter((e) => e.category === "특전").length;
  console.log(
    `  결과: 수집 ${result.length} (특전 ${goodieCount}) / 상영 ${allScreenings.length}회차 / 기처리 ${skippedOld} / 일반 ${notGoodie} / 특전 저신뢰 ${lowConf}`
  );
  return { events: result, screenings: allScreenings };
}
