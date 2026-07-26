/**
 * CGV 상영시간표 → 정규화(collect)
 *
 *   수도권 극장(regnGrpCd 01/02/03) × 오늘~+N일 × searchMovScnInfo 순회.
 *   (api.cgv.co.kr — curl-impersonate + HMAC 서명, cgv/api.ts fetchJson 재사용)
 *
 *   pnpm --filter @cinemo/crawler cgv-schedule -- --dry --days=2 --max-cinemas=3
 *   pnpm --filter @cinemo/crawler cgv-schedule -- --days=8
 */

import {
  fetchMetroSites,
  fetchScreenSchedule,
  cgvRegionName,
  type CgvScnItem,
} from "./api";
import { ingestScreenings } from "../db/repo";
import type { CollectedScreening } from "../domain";

/** 오늘(KST)부터 days일치 YYYYMMDD 생성 */
function upcomingYmd(days: number): string[] {
  const KST = 9 * 3600e3;
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() + KST + i * 86400e3);
    out.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  return out;
}

/** "0930" → "09:30" */
function hhmm(t: string): string {
  if (/^\d{4}$/.test(t)) return `${t.slice(0, 2)}:${t.slice(2, 4)}`;
  return t;
}

function mapItem(s: CgvScnItem, region: string | undefined): CollectedScreening {
  return {
    chain: "CGV",
    branchCode: s.siteNo,
    branchName: s.siteNm,
    region,
    movieTitle: s.movNm,
    sourceMovieCode: s.movNo,
    playDate: `${s.scnYmd.slice(0, 4)}-${s.scnYmd.slice(4, 6)}-${s.scnYmd.slice(6, 8)}`,
    startTime: hhmm(s.scnsrtTm),
    endTime: hhmm(s.scnendTm) || undefined,
    screenName: s.scnsNm || undefined,
    format: s.movkndDsplNm || undefined,
    subtitleDub: s.sbtdivNm || undefined,
    remainingSeats: Number(s.frSeatCnt),
    totalSeats: Number(s.stcnt),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CgvScheduleOptions {
  days?: number;
  maxCinemas?: number;
  /** 극장명 부분일치 필터 (지정 시 해당 극장만) */
  only?: string[];
  /** 요청 간 딜레이 ms (rate-limit 회피, 기본 200) */
  delayMs?: number;
}

/** CGV 수도권 상영시간표 수집 */
export async function collectCgvScreenings(
  opts: CgvScheduleOptions = {}
): Promise<CollectedScreening[]> {
  const days = opts.days ?? 8;
  const delayMs = opts.delayMs ?? 200;
  const dates = upcomingYmd(days);

  let sites = await fetchMetroSites();
  if (opts.only?.length)
    sites = sites.filter((s) => opts.only!.some((k) => s.siteNm.includes(k)));
  if (opts.maxCinemas) sites = sites.slice(0, opts.maxCinemas);

  console.log(`수도권 CGV 극장 ${sites.length}곳 × ${days}일 수집`);

  const result: CollectedScreening[] = [];
  for (const site of sites) {
    const region = cgvRegionName(site.regnGrpCd);
    for (const ymd of dates) {
      let items: CgvScnItem[];
      try {
        items = await fetchScreenSchedule(site.siteNo, ymd);
      } catch (err) {
        console.error(
          `  ✗ ${site.siteNm} ${ymd} 실패: ${(err as Error).message}`
        );
        continue;
      }
      for (const s of items) result.push(mapItem(s, region));
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

  console.log(`=== CGV 상영시간표 수집 ${dry ? "(dry-run)" : ""} ===`);
  const collected = await collectCgvScreenings({ days, maxCinemas, only });
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

  const stats = await ingestScreenings("CGV", collected);
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
