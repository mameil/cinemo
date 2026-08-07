/**
 * 인스타 수집 단독 실행
 *
 *   pnpm --filter @cinemo/crawler insta -- --dry --max=3     # 파싱 결과만 확인
 *   pnpm --filter @cinemo/crawler insta                      # 수집 → 적재
 *   pnpm --filter @cinemo/crawler insta -- --backfill-timetable
 *     # 이미 수집된 "극장" 게시물(R2 이미지)에서 시간표만 재추출 → screenings 적재
 *   pnpm --filter @cinemo/crawler insta -- --seed --max=50
 *     # 계정 활성화 시 1회: 과거 게시물 아카이브만 (이벤트 미생성 — 동명 영화 판별용)
 *   pnpm --filter @cinemo/crawler insta -- --local
 *     # 집 맥 Chrome으로 무로그인 수집 (Apify 크레딧 미사용 — launchd 데일리용)
 */

import { collectInsta, buildEvents, fetchPosts, type ApifyPost } from "./collect";
import { ingest, ingestScreenings, upsertTheater, recordCrawlRun } from "../db/repo";
import { parseTimetable, noteToFormat } from "./timetable";
import type { ParsedGoodiePost } from "./parse";
import { INSTA_ACCOUNTS } from "./accounts";
import type { CollectedEvent, CollectedScreening } from "../domain";
import { copyImageToR2 } from "../lib/r2";
import { db } from "@cinemo/shared";
import { sql } from "drizzle-orm";

/**
 * 백필: raw_posts에 보관된 극장 게시물에서 시간표 재추출.
 * 이벤트가 있으면 만료되지 않는 R2 이미지를 우선하고, 시드에만 보관돼 이벤트가
 * 없는 게시물은 raw의 인스타 이미지로 재시도한다.
 */
async function backfillTimetables(dry: boolean, only?: string[]) {
  const rows = (await db.all(sql`
    SELECT
      rp.source_id,
      rp.raw_json,
      ev.source_url,
      ev.detail_image_urls
    FROM raw_posts rp
    LEFT JOIN events ev
      ON ev.chain = 'INDIE' AND ev.source_event_id = 'ig-' || rp.source_id
    WHERE rp.source = 'INSTA'
      AND json_extract(rp.raw_json, '$.parsed.category') = '극장'
    ORDER BY json_extract(rp.raw_json, '$.post.timestamp') DESC
  `)) as {
    source_id: string;
    raw_json: string;
    source_url: string | null;
    detail_image_urls: string | null;
  }[];

  const onlySet = only?.length ? new Set(only.map((handle) => handle.toLowerCase())) : null;
  console.log(`  극장 게시물 ${rows.length}건 검사${onlySet ? ` (--only ${[...onlySet].join(",")})` : ""}`);
  // 시드 게시물의 인스타 CDN URL은 만료될 수 있다. 대상 계정을 지정한 복구 실행은
  // 최근 게시물을 다시 받아 동일 ID의 신선한 이미지 URL을 우선 사용한다.
  const freshById = new Map<string, ApifyPost>();
  if (onlySet) {
    const fresh = await fetchPosts([...onlySet], 10);
    for (const post of fresh) {
      if (post.id) freshById.set(post.id, post);
    }
    console.log(`  최신 게시물 ${freshById.size}건 이미지 URL 갱신`);
  }
  const all: CollectedScreening[] = [];
  for (const row of rows) {
    const raw = JSON.parse(row.raw_json) as { post: ApifyPost; parsed: ParsedGoodiePost };
    const account = INSTA_ACCOUNTS.find(
      (a) => a.handle.toLowerCase() === (raw.post.ownerUsername ?? "").toLowerCase()
    );
    if (!account) {
      console.log(`  ⚠️ 계정 미확인, 건너뜀: ${raw.post.ownerUsername ?? row.source_id}`);
      continue;
    }
    if (onlySet && !onlySet.has(account.handle.toLowerCase())) continue;

    const r2Images = row.detail_image_urls
      ? (JSON.parse(row.detail_image_urls) as string[])
      : [];
    const freshPost = freshById.get(row.source_id);
    const sourcePost = freshPost ?? raw.post;
    const rawImages = sourcePost.images?.length
      ? sourcePost.images
      : sourcePost.displayUrl
        ? [sourcePost.displayUrl]
        : [];
    const images = r2Images.length ? r2Images : rawImages;
    if (!images.length) {
      console.log(`  ⚠️ 이미지 없음, 건너뜀: ${account.theaterName} ${row.source_id}`);
      continue;
    }

    try {
      const tt = await parseTimetable({
        imageUrls: images,
        caption: raw.post.caption ?? raw.parsed.summary ?? "",
      });
      if (!tt.isTimetable || tt.confidence < 0.7) {
        console.log(`  — 시간표 아님/저신뢰: [${account.theaterName}] ${raw.parsed.summary}`);
        continue;
      }
      console.log(
        `  🎞️ [${account.theaterName}] ${raw.parsed.summary} → ${tt.screenings.length}회차 (conf ${tt.confidence})`
      );
      all.push(
        ...tt.screenings.map((s) => ({
          chain: "INDIE" as const,
          branchCode: `ig-${account.handle}`,
          branchName: account.theaterName,
          region: account.region,
          movieTitle: s.movieTitle,
          playDate: s.date,
          startTime: s.time,
          screenName: "상영관",
          format: noteToFormat(s.note),
          bookingUrl:
            row.source_url ??
            raw.post.url ??
            (raw.post.shortCode ? `https://www.instagram.com/p/${raw.post.shortCode}/` : undefined),
        }))
      );
    } catch (err) {
      console.error(`  ⚠️ 추출 실패 [${row.source_id}]: ${(err as Error).message.slice(0, 100)}`);
    }
  }

  if (dry) {
    for (const s of all.slice(0, 10)) {
      console.log(`  [dry] ${s.branchName} ${s.playDate} ${s.startTime} ${s.movieTitle} ${s.format ?? ""}`);
    }
    console.log(`=== dry-run 종료 — 총 ${all.length}회차 (DB 미적재) ===`);
    return;
  }
  const stats = await ingestScreenings("INDIE", all);
  console.log("=== 시간표 백필 완료 ===");
  console.log(stats);
}

/**
 * 특전 백필: 시드로만 아카이브돼 이벤트가 안 된 특전 게시물을 승격한다.
 * (시드는 의도적으로 이벤트 미생성 — 계정 활성화 전 공지된 "진행 중" 특전이 묻히는 공백 보완)
 *
 * 승격 기준 (끝난 특전이 '보유'로 뜨는 오염 방지, 설계서 2026-07-26·27):
 *   특전 분류 + isGoodieEvent + confidence ≥ 0.8 + 아래 기간 판정 중 하나
 *   ① 종료일 명시 + 오늘 이후
 *   ② 종료일 없음 + "N주차" 패턴 → 종료일 = 시작일 + 6일로 간주 후 ①로 판정
 *      (상상마당 해피엔드처럼 주차별 릴레이 특전은 종료일을 안 적는다 — 2026-07-27 실사례)
 *   ③ 종료일 없음 + 비주차 → 시작일이 최근 7일 이내(또는 미래)면 진행 중으로 승격
 *      (기본 종료일 +30일은 buildEvent가 부여 — 데일리 수집과 동일한 동작)
 * 이미지: 시드는 R2 복사를 안 하므로 인스타 CDN 원본에서 재시도 — 서명 만료면 이미지 없이 승격.
 */
const WEEKLY_GOODIE_PATTERN = /\d+\s*주\s*차/;

async function backfillGoodies(dry: boolean) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const addDays = (d: string, n: number) => {
    const dt = new Date(d + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  };
  const rows = (await db.all(sql`
    SELECT source_id, raw_json FROM raw_posts
    WHERE source = 'INSTA'
      AND json_extract(raw_json, '$.parsed.category') = '특전'
      AND json_extract(raw_json, '$.parsed.isGoodieEvent') = 1
      AND CAST(json_extract(raw_json, '$.parsed.confidence') AS REAL) >= 0.8
      AND NOT EXISTS (
        SELECT 1 FROM events ev
        WHERE ev.source_event_id = 'ig-' || raw_posts.source_id
           OR ev.source_event_id LIKE 'ig-' || raw_posts.source_id || '-movie-%'
      )
  `)) as { source_id: string; raw_json: string }[];

  console.log(`  특전 아카이브(이벤트 미존재) ${rows.length}건 — 기간 판정 시작 (오늘 ${today})`);
  const events: CollectedEvent[] = [];
  for (const row of rows) {
    const { post, parsed } = JSON.parse(row.raw_json) as { post: ApifyPost; parsed: ParsedGoodiePost };
    const account = INSTA_ACCOUNTS.find(
      (a) => a.handle.toLowerCase() === (post.ownerUsername ?? "").toLowerCase()
    );
    if (!account) {
      console.log(`  ⚠️ 계정 미확인, 건너뜀: ${post.ownerUsername} ${row.source_id}`);
      continue;
    }

    // 기간 판정 — 주석의 ①②③
    if (!parsed.endDate && parsed.startDate && WEEKLY_GOODIE_PATTERN.test(parsed.summary ?? "")) {
      parsed.endDate = addDays(parsed.startDate, 6); // ② 주차 특전 = 그 주만
    }
    if (parsed.endDate) {
      if (parsed.endDate < today) continue; // ① 종료됨
    } else if (parsed.startDate) {
      if (parsed.startDate < weekAgo) continue; // ③ 오래된 시작 + 기간 불명 → 보류
    } else {
      const postDate = (post.timestamp ?? "").slice(0, 10);
      const monthAgo = addDays(today, -30);
      // "~소진 시까지" 공지는 명시 종료일이 없어도 최근 게시물이라면 진행 중으로 본다.
      if (/소진\s*시/i.test(`${post.caption ?? ""} ${parsed.conditions ?? ""}`) &&
          postDate >= monthAgo && postDate <= today) {
        parsed.startDate = postDate;
      } else {
        continue; // 기간 정보 전무 → 판정 불가
      }
    }

    // 시드는 R2 복사를 생략했으므로 여기서 복사 — CDN 서명 만료 시 이미지 없이 진행
    const cdnImages = post.images?.length ? post.images : post.displayUrl ? [post.displayUrl] : [];
    const r2Urls: string[] = [];
    if (!dry) {
      const imageLimit = !parsed.movieTitle && parsed.goodies.length > 1 ? 10 : 3;
      for (let i = 0; i < Math.min(cdnImages.length, imageLimit); i++) {
        try {
          r2Urls.push(await copyImageToR2(cdnImages[i], `insta/${account.handle}/${post.id}_${i}.jpg`));
        } catch {
          // CDN 만료 — 남은 이미지도 대부분 만료이므로 시도만 하고 조용히 넘어감
        }
      }
    }

    const built = buildEvents(post, parsed, account, r2Urls, true);
    events.push(...built);
    console.log(
      `  ${dry ? "[dry] " : ""}승격: ${account.theaterName} | ${parsed.summary} | ~${parsed.endDate}` +
        ` | 이벤트 ${built.length} · 굿즈 ${parsed.goodies.length} | 이미지 ${r2Urls.length}/${cdnImages.length}`
    );
  }

  if (dry) {
    console.log(`=== dry-run 종료 — ${events.length}건 승격 대상 (DB 미적재) ===`);
    return;
  }
  if (!events.length) {
    console.log("=== 승격 대상 없음 ===");
    return;
  }
  const stats = await ingest("INDIE", events);
  console.log("=== 특전 백필 완료 ===");
  console.log(stats);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dry = args.includes("--dry");
  const maxArg = args.find((a) => a.startsWith("--max="));
  const maxPosts = maxArg ? Number(maxArg.split("=")[1]) : undefined;
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.split("=")[1].split(",").filter(Boolean) : undefined;
  // 수집 경로: --local(집 맥 Chrome, Apify 크레딧 미사용) / 기본 Apify.
  // env INSTA_FETCHER=local 로도 지정됨 (launchd에서 사용).
  const fetcher: "apify" | "local" | undefined = args.includes("--local")
    ? "local"
    : undefined;

  // 게시물·특전·상영 회차가 아직 없는 관도 웹 필터에서 안정적인 ID로 표시되도록
  // 매 실행 시 v1 대상 12관을 먼저 등록한다.
  if (!dry) {
    for (const account of INSTA_ACCOUNTS.filter((a) => a.enabled)) {
      await upsertTheater("INDIE", {
        branchCode: `ig-${account.handle}`,
        branchName: account.theaterName,
        region: account.region,
      });
    }
  }

  if (args.includes("--backfill-timetable")) {
    console.log(`=== 인스타 시간표 백필 ${dry ? "(dry-run)" : ""} ===`);
    await backfillTimetables(dry, only);
    return;
  }

  if (args.includes("--backfill-goodies")) {
    console.log(`=== 인스타 특전 백필 ${dry ? "(dry-run)" : ""} — 시드 특전 승격 ===`);
    await backfillGoodies(dry);
    return;
  }

  const seed = args.includes("--seed");
  if (seed) {
    console.log(`=== 인스타 시드 아카이브 ${dry ? "(dry-run)" : ""} — 이벤트 미생성 ===`);
    await collectInsta({ maxPosts: maxPosts ?? 50, dry, seed: true, only, fetcher });
    console.log("=== 시드 완료 ===");
    return;
  }

  console.log(`=== 인스타 수집 시작 ${dry ? "(dry-run: DB 미적재)" : ""} ===`);

  if (dry) {
    const { events, screenings } = await collectInsta({ maxPosts, dry, only, fetcher });
    for (const ev of events) {
      console.log(`\n[${ev.sourceEventId}] ${ev.eventName}`);
      console.log(`  기간: ${ev.startDate} ~ ${ev.endDate} | 영화: ${ev.movieTitle ?? "-"}`);
      console.log(`  굿즈: ${ev.goodies.map((g) => g.name).join(", ")}`);
    }
    console.log(`\n=== dry-run 종료 — 이벤트 ${events.length} · 상영 ${screenings.length}회차 (DB 미적재) ===`);
    return;
  }

  // 비-dry 실행은 crawl_runs에 결과를 남긴다 — 두 PC 로컬 배치를 어디서든 가시화 (2026-08-08).
  const runSource =
    fetcher === "local" || process.env.INSTA_FETCHER === "local"
      ? "insta-local"
      : "insta-apify";
  const startedAt = new Date().toISOString();
  try {
    const { events, screenings } = await collectInsta({ maxPosts, only, fetcher });
    const stats = await ingest("INDIE", events);
    console.log("=== 이벤트 적재 완료 ===");
    console.log(stats);
    let screeningCount = 0;
    if (screenings.length) {
      const sStats = await ingestScreenings("INDIE", screenings);
      console.log("=== 상영 적재 완료 ===");
      console.log(sStats);
      screeningCount = sStats.screenings;
    }
    await recordCrawlRun({
      source: runSource,
      startedAt,
      status: "success",
      events: stats.events,
      screenings: screeningCount,
      detail:
        `이벤트 ${stats.events} / 상영 ${screeningCount}회차` +
        (stats.skipped ? ` / 스킵 ${stats.skipped}` : ""),
    });
  } catch (err) {
    await recordCrawlRun({
      source: runSource,
      startedAt,
      status: "error",
      detail: (err as Error).message.slice(0, 300),
    });
    throw err; // exit 1 유지 (스케줄러/로그에도 실패로 남게)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
