/**
 * 롯데시네마 상영시간표 → 정규화(collect)
 *
 *   수도권 지점(위경도 바운딩박스) × 오늘~+N일 × GetPlaySequence 순회.
 *
 *   pnpm --filter @cinemo/crawler lotte-schedule -- --dry --days=2 --max-cinemas=3
 *   pnpm --filter @cinemo/crawler lotte-schedule -- --days=8
 */

import { fetchCinemaList, fetchPlaySequence, type LotteCinema } from "./api";
import { ingestScreenings } from "../db/repo";
import type { CollectedScreening } from "../domain";

// 수도권 대략 바운딩박스 (서울/경기/인천)
const SUDOKWON = { latMin: 36.9, latMax: 38.3, lngMin: 126.1, lngMax: 127.9 };

function inSudokwon(c: LotteCinema): boolean {
  const lat = Number(c.Latitude);
  const lng = Number(c.Longitude);
  if (!lat || !lng) return false;
  return (
    lat >= SUDOKWON.latMin &&
    lat <= SUDOKWON.latMax &&
    lng >= SUDOKWON.lngMin &&
    lng <= SUDOKWON.lngMax
  );
}

/** 위경도로 서울/인천/경기 대략 분류 (정밀하지 않음, 표시용) */
function regionOf(c: LotteCinema): string {
  const lat = Number(c.Latitude);
  const lng = Number(c.Longitude);
  if (lat >= 37.42 && lat <= 37.7 && lng >= 126.76 && lng <= 127.19) return "서울";
  if (lat >= 37.3 && lat <= 37.6 && lng >= 126.37 && lng < 126.76) return "인천";
  return "경기";
}

/** 오늘(KST)부터 days일치 날짜 문자열(YYYY-MM-DD) 생성 */
function upcomingDates(days: number): string[] {
  const KST = 9 * 3600e3;
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    out.push(new Date(Date.now() + KST + i * 86400e3).toISOString().slice(0, 10));
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LotteScheduleOptions {
  /** 수집할 일수 (오늘부터) 기본 8 */
  days?: number;
  /** 지점 수 제한 (테스트용) */
  maxCinemas?: number;
  /** 지점명 부분일치 필터 */
  only?: string[];
  /** 요청 간 딜레이 ms (기본 200) */
  delayMs?: number;
}

/** 롯데 수도권 상영시간표를 CollectedScreening[]로 수집 */
export async function collectLotteScreenings(
  opts: LotteScheduleOptions = {}
): Promise<CollectedScreening[]> {
  const days = opts.days ?? 8;
  const delayMs = opts.delayMs ?? 200;
  const dates = upcomingDates(days);

  const all = await fetchCinemaList();
  let cinemas = all.filter(inSudokwon);
  if (opts.only?.length)
    cinemas = cinemas.filter((c) =>
      opts.only!.some((k) => c.CinemaNameKR.includes(k))
    );
  if (opts.maxCinemas) cinemas = cinemas.slice(0, opts.maxCinemas);

  console.log(
    `수도권 롯데 지점 ${cinemas.length}곳 × ${days}일 (${dates[0]}~${dates[dates.length - 1]}) 수집`
  );

  const result: CollectedScreening[] = [];
  for (const c of cinemas) {
    const region = regionOf(c);
    for (const date of dates) {
      let seqs;
      try {
        seqs = await fetchPlaySequence(c.DivisionCode, c.CinemaID, date);
      } catch (err) {
        console.error(
          `  ✗ ${c.CinemaNameKR} ${date} 조회 실패: ${(err as Error).message}`
        );
        continue;
      }
      for (const s of seqs) {
        result.push({
          chain: "LOTTE",
          branchCode: String(c.CinemaID),
          branchName: c.CinemaNameKR,
          region,
          movieTitle: s.MovieNameKR,
          sourceMovieCode: s.RepresentationMovieCode || s.MovieCode,
          playDate: s.PlayDt,
          startTime: s.StartTime,
          endTime: s.EndTime || undefined,
          screenName: s.ScreenNameKR || undefined,
          format: s.FilmNameKR || undefined,
          subtitleDub: s.TranslationDivisionNameKR || undefined,
          remainingSeats: s.BookingSeatCount,
          totalSeats: s.TotalSeatCount,
          posterUrl: s.PosterURL || undefined,
        });
      }
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
  const days = daysArg ? Number(daysArg.split("=")[1]) : undefined;
  const maxCinemas = maxArg ? Number(maxArg.split("=")[1]) : undefined;

  console.log(`=== 롯데 상영시간표 수집 ${dry ? "(dry-run)" : ""} ===`);
  const collected = await collectLotteScreenings({ days, maxCinemas });
  console.log(`회차 ${collected.length}건 수집\n`);

  if (dry) {
    // 지점별 요약 + 샘플
    const byBranch = new Map<string, number>();
    for (const s of collected)
      byBranch.set(s.branchName, (byBranch.get(s.branchName) ?? 0) + 1);
    for (const [b, n] of byBranch) console.log(`  ${b}: ${n}회차`);
    console.log("\n샘플 5건:");
    for (const s of collected.slice(0, 5)) {
      console.log(
        `  ${s.playDate} ${s.startTime} | ${s.branchName} ${s.screenName} | ${s.movieTitle}(${s.format}/${s.subtitleDub}) | 잔여 ${s.remainingSeats}/${s.totalSeats}`
      );
    }
    console.log("\n=== dry-run 종료 (DB 미적재) ===");
    return;
  }

  const stats = await ingestScreenings("LOTTE", collected);
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
