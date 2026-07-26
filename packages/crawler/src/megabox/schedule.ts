/**
 * 메가박스 상영시간표 → 정규화(collect)
 *
 *   수도권 지점(areaCd 10/30/35) × 오늘~+N일 × schedulePage.do 순회.
 *
 *   pnpm --filter @cinemo/crawler megabox-schedule -- --dry --days=2 --max-cinemas=3
 *   pnpm --filter @cinemo/crawler megabox-schedule -- --days=8
 */

import {
  fetchMetroBranches,
  fetchSchedule,
  decodeHtmlEntities,
  type MegaScheduleItem,
} from "./api";
import { ingestScreenings } from "../db/repo";
import type { CollectedScreening } from "../domain";

/** 오늘(KST)부터 days일치 YYYYMMDD 생성 (메가는 최대 ~13일 공개) */
function upcomingYmd(days: number): string[] {
  const KST = 9 * 3600e3;
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() + KST + i * 86400e3);
    out.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return out;
}

/** "2D(자막)" → 자막/더빙 추출 */
function subtitleDub(playKindNm: string): string | undefined {
  if (/자막/.test(playKindNm)) return "자막";
  if (/더빙/.test(playKindNm)) return "더빙";
  return undefined;
}

/** "2D(자막)" → "2D", "2D ATMOS(자막)" → "2D ATMOS" (괄호 앞) */
function formatOf(playKindNm: string): string {
  return playKindNm.replace(/\s*\(.*\)\s*/g, "").trim() || playKindNm.trim();
}

function mapItem(
  s: MegaScheduleItem,
  region: string
): CollectedScreening {
  return {
    chain: "MEGA",
    branchCode: s.brchNo,
    branchName: decodeHtmlEntities(s.brchNm),
    region,
    movieTitle: decodeHtmlEntities(s.rpstMovieNm || s.movieNm),
    sourceMovieCode: s.rpstMovieNo || s.movieNo,
    playDate: `${s.playDe.slice(0, 4)}-${s.playDe.slice(4, 6)}-${s.playDe.slice(6, 8)}`,
    startTime: s.playStartTime,
    endTime: s.playEndTime || undefined,
    screenName: decodeHtmlEntities(s.theabExpoNm) || undefined,
    format: formatOf(decodeHtmlEntities(s.playKindNm)),
    subtitleDub: subtitleDub(s.playKindNm),
    remainingSeats: s.restSeatCnt,
    totalSeats: s.totSeatCnt,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface MegaScheduleOptions {
  days?: number;
  maxCinemas?: number;
  /** 지점명 부분일치 필터 */
  only?: string[];
  /** 요청 간 딜레이 ms (rate-limit 회피, 기본 200) */
  delayMs?: number;
}

/** 메가박스 수도권 상영시간표 수집 */
export async function collectMegaboxScreenings(
  opts: MegaScheduleOptions = {}
): Promise<CollectedScreening[]> {
  const days = Math.min(opts.days ?? 8, 13);
  const delayMs = opts.delayMs ?? 200;
  const dates = upcomingYmd(days);

  let branches = await fetchMetroBranches(dates[0]);
  if (opts.only?.length)
    branches = branches.filter((b) => opts.only!.some((k) => b.brchNm.includes(k)));
  if (opts.maxCinemas) branches = branches.slice(0, opts.maxCinemas);

  console.log(`수도권 메가박스 지점 ${branches.length}곳 × ${days}일 수집`);

  const result: CollectedScreening[] = [];
  for (const b of branches) {
    for (const ymd of dates) {
      let items: MegaScheduleItem[];
      try {
        items = await fetchSchedule(b.brchNo, ymd);
      } catch (err) {
        console.error(`  ✗ ${b.brchNm} ${ymd} 실패: ${(err as Error).message}`);
        continue;
      }
      for (const s of items) result.push(mapItem(s, b.areaCdNm));
      await sleep(delayMs); // rate-limit 회피
    }
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dry = args.includes("--dry");
  const daysArg = args.find((a) => a.startsWith("--days="));
  const maxArg = args.find((a) => a.startsWith("--max-cinemas="));
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const days = daysArg ? Number(daysArg.split("=")[1]) : undefined;
  const maxCinemas = maxArg ? Number(maxArg.split("=")[1]) : undefined;
  const only = onlyArg ? onlyArg.split("=")[1].split(",").filter(Boolean) : undefined;

  console.log(`=== 메가박스 상영시간표 수집 ${dry ? "(dry-run)" : ""} ===`);
  const collected = await collectMegaboxScreenings({ days, maxCinemas, only });
  console.log(`회차 ${collected.length}건 수집\n`);

  if (dry) {
    const byBranch = new Map<string, number>();
    for (const s of collected)
      byBranch.set(s.branchName, (byBranch.get(s.branchName) ?? 0) + 1);
    for (const [b, n] of byBranch) console.log(`  ${b}: ${n}회차`);
    console.log("\n샘플 5건:");
    for (const s of collected.slice(0, 5)) {
      console.log(
        `  ${s.playDate} ${s.startTime} | ${s.branchName} ${s.screenName} | ${s.movieTitle}(${s.format}/${s.subtitleDub ?? "-"}) | 잔여 ${s.remainingSeats}/${s.totalSeats}`
      );
    }
    console.log("\n=== dry-run 종료 (DB 미적재) ===");
    return;
  }

  const stats = await ingestScreenings("MEGA", collected);
  console.log("=== 적재 완료 ===");
  console.log(stats);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
