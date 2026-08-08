/** 아트하우스 모모 공식 Dtryx 날짜별 시간표 API. */

import type { CollectedScreening } from "../domain";

const API =
  "https://api.dtryx.com:30443/dtryx/cms/thirdparty/movie/third-party-type2-timetable-list" +
  "?BrandCd=indieart&CinemaCd=000067&ChannelCd=homepage&EngVerYn=N" +
  "&PlaySDT={date}&ImgSize=small&WorkGuID=37E0BA0F-DA5F-4376-9BA4-B5D27286AB87";
const BOOKING_URL = "https://arthousemomo.co.kr/showtimes";

interface MomoRow {
  MovieCd?: string;
  MovieNm?: string;
  PlaySDT?: string;
  StartTime?: string;
  EndTime?: string;
  ScreenNm?: string;
  ScreeningInfo?: string;
  RemainSeatCnt?: string;
  TotalSeatCnt?: string;
  Url?: string; // 공식 포스터 이미지 URL (img.dtryx.com/poster/... — PosterGuID 해석본, 2026-08-08 발견)
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

interface DtryxTheater {
  cinemaCode: string;
  brandCode?: string;
  workGuid?: string;
  branchCode: string;
  branchName: string;
  bookingUrl: string;
}

async function fetchDate(date: string, theater: DtryxTheater): Promise<CollectedScreening[]> {
  const url = API
    .replace("BrandCd=indieart", `BrandCd=${theater.brandCode ?? "indieart"}`)
    .replace("CinemaCd=000067", `CinemaCd=${theater.cinemaCode}`)
    .replace("37E0BA0F-DA5F-4376-9BA4-B5D27286AB87", theater.workGuid ?? "37E0BA0F-DA5F-4376-9BA4-B5D27286AB87")
    .replace("{date}", date);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${theater.branchName} 공식 API HTTP ${res.status} (${date})`);
  const body = await res.json() as { RetCode?: string; RetMsg?: string; Recordset?: MomoRow[] };
  if (!Array.isArray(body.Recordset)) {
    throw new Error(`${theater.branchName} 공식 API 오류 (${date}): ${body.RetMsg ?? body.RetCode ?? "응답 형식"}`);
  }
  return body.Recordset.flatMap((row) => {
    if (!row.MovieNm || !row.PlaySDT || !row.StartTime) return [];
    return [{
      chain: "INDIE" as const,
      branchCode: theater.branchCode,
      branchName: theater.branchName,
      region: "서울",
      movieTitle: row.MovieNm,
      sourceMovieCode: row.MovieCd,
      playDate: row.PlaySDT.slice(0, 10),
      startTime: row.StartTime,
      endTime: row.EndTime,
      screenName: row.ScreenNm,
      format: row.ScreeningInfo?.replace(/\(.*\)/, "") || undefined,
      subtitleDub: row.ScreeningInfo?.includes("자막") ? "자막" : undefined,
      remainingSeats: Number.isFinite(Number(row.RemainSeatCnt)) ? Number(row.RemainSeatCnt) : undefined,
      totalSeats: Number.isFinite(Number(row.TotalSeatCnt)) ? Number(row.TotalSeatCnt) : undefined,
      bookingUrl: theater.bookingUrl,
      posterUrl: row.Url?.startsWith("http") ? row.Url : undefined, // 공식 포스터 (TMDB 미매칭작 폴백)
    }];
  });
}

export async function collectDtryxIndieScreenings(theater: DtryxTheater, options: {
  days?: number;
  startDate?: string;
} = {}): Promise<CollectedScreening[]> {
  const days = Math.max(1, Math.min(options.days ?? 8, 14));
  const startDate =
    options.startDate ?? new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const dates = Array.from({ length: days }, (_, i) => addDays(startDate, i));
  const rows: CollectedScreening[] = [];
  for (let i = 0; i < dates.length; i += 2) {
    rows.push(...(await Promise.all(dates.slice(i, i + 2).map((date) => fetchDate(date, theater)))).flat());
  }
  console.log(`  ${theater.branchName} 공식 시간표: ${days}일 · ${rows.length}회차`);
  return rows;
}

export async function collectMomoScreenings(options: {
  days?: number;
  startDate?: string;
} = {}): Promise<CollectedScreening[]> {
  return collectDtryxIndieScreenings({
    cinemaCode: "000067",
    branchCode: "ig-arthousemomo",
    branchName: "아트하우스 모모",
    bookingUrl: BOOKING_URL,
  }, options);
}
