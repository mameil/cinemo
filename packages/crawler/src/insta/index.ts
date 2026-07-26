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

import { collectInsta } from "./collect";
import { ingest, ingestScreenings } from "../db/repo";
import { parseTimetable, noteToFormat } from "./timetable";
import { INSTA_ACCOUNTS } from "./accounts";
import type { CollectedScreening } from "../domain";
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

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dry = args.includes("--dry");
  const maxArg = args.find((a) => a.startsWith("--max="));
  const maxPosts = maxArg ? Number(maxArg.split("=")[1]) : undefined;

  if (args.includes("--backfill-timetable")) {
    console.log(`=== 인스타 시간표 백필 ${dry ? "(dry-run)" : ""} ===`);
    await backfillTimetables(dry);
    return;
  }

  const seed = args.includes("--seed");
  if (seed) {
    console.log(`=== 인스타 시드 아카이브 ${dry ? "(dry-run)" : ""} — 이벤트 미생성 ===`);
    await collectInsta({ maxPosts: maxPosts ?? 50, dry, seed: true });
    console.log("=== 시드 완료 ===");
    return;
  }

  console.log(`=== 인스타 수집 시작 ${dry ? "(dry-run: DB 미적재)" : ""} ===`);
  const { events, screenings } = await collectInsta({ maxPosts, dry });

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
