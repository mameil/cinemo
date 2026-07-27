/**
 * 인스타 수집 단독 실행
 *
 *   pnpm --filter @cinemo/crawler insta -- --dry --max=3     # 파싱 결과만 확인
 *   pnpm --filter @cinemo/crawler insta                      # 수집 → 적재
 *   pnpm --filter @cinemo/crawler insta -- --backfill-timetable
 *     # 이미 수집된 "극장" 게시물(R2 이미지)에서 시간표만 재추출 → screenings 적재
 *   pnpm --filter @cinemo/crawler insta -- --seed --max=50
 *     # 계정 활성화 시 1회: 과거 게시물 아카이브만 (이벤트 미생성 — 동명 영화 판별용)
 */

import { collectInsta, buildEvent, type ApifyPost } from "./collect";
import { ingest, ingestScreenings } from "../db/repo";
import { parseTimetable, noteToFormat } from "./timetable";
import type { ParsedGoodiePost } from "./parse";
import { INSTA_ACCOUNTS } from "./accounts";
import type { CollectedEvent, CollectedScreening } from "../domain";
import { copyImageToR2 } from "../lib/r2";
import { db } from "@cinemo/shared";
import { sql } from "drizzle-orm";

/**
 * 백필: 이미 이벤트로 적재된 극장 게시물의 R2 이미지에서 시간표 재추출.
 * (raw_posts dedup 때문에 일반 수집 경로로는 재처리되지 않는 과거 게시물용)
 */
async function backfillTimetables(dry: boolean) {
  const rows = (await db.all(sql`
    SELECT source_event_id, event_name, source_url, detail_image_urls
    FROM events
    WHERE chain = 'INDIE' AND category = '극장' AND detail_image_urls IS NOT NULL
  `)) as { source_event_id: string; event_name: string; source_url: string | null; detail_image_urls: string }[];

  console.log(`  극장 게시물 ${rows.length}건 검사`);
  const all: CollectedScreening[] = [];
  for (const row of rows) {
    // 이벤트명 "[라이카시네마] …" 접두로 계정 역추적
    const account = INSTA_ACCOUNTS.find((a) => row.event_name.startsWith(`[${a.theaterName}]`));
    if (!account) {
      console.log(`  ⚠️ 계정 미확인, 건너뜀: ${row.event_name}`);
      continue;
    }
    const images = JSON.parse(row.detail_image_urls) as string[];
    try {
      const tt = await parseTimetable({ imageUrls: images, caption: row.event_name });
      if (!tt.isTimetable || tt.confidence < 0.7) {
        console.log(`  — 시간표 아님/저신뢰: ${row.event_name}`);
        continue;
      }
      console.log(`  🎞️ ${row.event_name} → ${tt.screenings.length}회차 (conf ${tt.confidence})`);
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
          bookingUrl: row.source_url ?? undefined,
        }))
      );
    } catch (err) {
      console.error(`  ⚠️ 추출 실패 [${row.source_event_id}]: ${(err as Error).message.slice(0, 100)}`);
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
      AND NOT EXISTS (SELECT 1 FROM events ev WHERE ev.source_event_id = 'ig-' || raw_posts.source_id)
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
      continue; // 기간 정보 전무 → 판정 불가
    }

    // 시드는 R2 복사를 생략했으므로 여기서 복사 — CDN 서명 만료 시 이미지 없이 진행
    const cdnImages = post.images?.length ? post.images : post.displayUrl ? [post.displayUrl] : [];
    const r2Urls: string[] = [];
    if (!dry) {
      for (let i = 0; i < Math.min(cdnImages.length, 3); i++) {
        try {
          r2Urls.push(await copyImageToR2(cdnImages[i], `insta/${account.handle}/${post.id}_${i}.jpg`));
        } catch {
          // CDN 만료 — 남은 이미지도 대부분 만료이므로 시도만 하고 조용히 넘어감
        }
      }
    }

    const ev = buildEvent(post, parsed, account, r2Urls, true);
    events.push(ev);
    console.log(
      `  ${dry ? "[dry] " : ""}승격: ${account.theaterName} | ${parsed.summary} | ~${parsed.endDate}` +
        ` | 굿즈 ${parsed.goodies.length} | 이미지 ${r2Urls.length}/${cdnImages.length}`
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

  if (args.includes("--backfill-timetable")) {
    console.log(`=== 인스타 시간표 백필 ${dry ? "(dry-run)" : ""} ===`);
    await backfillTimetables(dry);
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
    await collectInsta({ maxPosts: maxPosts ?? 50, dry, seed: true, only });
    console.log("=== 시드 완료 ===");
    return;
  }

  console.log(`=== 인스타 수집 시작 ${dry ? "(dry-run: DB 미적재)" : ""} ===`);
  const { events, screenings } = await collectInsta({ maxPosts, dry, only });

  if (dry) {
    for (const ev of events) {
      console.log(`\n[${ev.sourceEventId}] ${ev.eventName}`);
      console.log(`  기간: ${ev.startDate} ~ ${ev.endDate} | 영화: ${ev.movieTitle ?? "-"}`);
      console.log(`  굿즈: ${ev.goodies.map((g) => g.name).join(", ")}`);
    }
    console.log(`\n=== dry-run 종료 — 이벤트 ${events.length} · 상영 ${screenings.length}회차 (DB 미적재) ===`);
    return;
  }

  const stats = await ingest("INDIE", events);
  console.log("=== 이벤트 적재 완료 ===");
  console.log(stats);
  if (screenings.length) {
    const sStats = await ingestScreenings("INDIE", screenings);
    console.log("=== 상영 적재 완료 ===");
    console.log(sStats);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
