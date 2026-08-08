/**
 * MOVIEE 공용 시간표 수집기 (예매처 moviee.co.kr).
 *
 * 필름포럼(haman/130)에서 쓰던 로직을 극장별 파라미터(서브도메인·tId)로 일반화.
 * 상상마당(sancheong/123)·KU(sancheong/121)가 MOVIEE로 전환돼 재사용한다 (2026-08-08 실측).
 * 날짜는 오늘부터 순회하며 GetPlayTimeList를 호출한다 (편성 없는 날은 빈 응답).
 */

import type { CollectedScreening } from "../domain";

export interface MovieeTheater {
  baseUrl: string; // 예: https://sancheong.moviee.co.kr
  theaterId: string; // tId (thsynid)
  branchCode: string;
  branchName: string;
  bookingUrl: string;
}

interface MovieeRow {
  TS_NM?: string;
  PLAY_TIME?: string;
  END_TIME?: string;
  PLAY_DT?: string;
  M_ID?: string;
  M_NM?: string;
  SUBTITLE?: string;
  SEAT_CNT?: string;
  REMAINSEAT_CNT?: string;
  THUMB_FILE?: string;
}

/** MOVIEE 썸네일 파일명 → 이미지 URL (TMDB 미등재작 포스터 폴백) */
function movieeImageUrl(file?: string): string | undefined {
  return file?.trim()
    ? `https://movie-img.moviee.co.kr/DisplayImage?key=${file.trim()}`
    : undefined;
}

function cleanTitle(value: string): string {
  const title = value.replace(/\((?:2D|3D|자막|더빙|영문자막)\)\s*$/i, "").trim();
  // 예매처에 간혹 제목 뒤 소개문이 붙는다. 콜론 앞이 정식 제목인 경우가 대부분.
  return title.length > 80 && title.includes(" : ") ? title.split(" : ", 1)[0].trim() : title;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchDate(theater: MovieeTheater, date: string): Promise<CollectedScreening[]> {
  const params = new URLSearchParams({
    tId: theater.theaterId,
    mId: "",
    playDt: date,
    ntId: "",
    gId: "",
  });
  const res = await fetch(`${theater.baseUrl}/api/TicketApi/GetPlayTimeList?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${theater.branchName} MOVIEE HTTP ${res.status} (${date})`);
  const body = (await res.json()) as {
    ResCd?: string;
    ResMsg?: string;
    ResData?: { Table?: MovieeRow[] };
  };
  if (body.ResCd !== "00" && body.ResCd !== "01") {
    throw new Error(`${theater.branchName} MOVIEE 오류 (${date}): ${body.ResMsg ?? body.ResCd}`);
  }
  const time = (v?: string) =>
    v && v.length >= 4 ? `${v.slice(0, 2)}:${v.slice(2, 4)}` : undefined;
  return (body.ResData?.Table ?? []).flatMap((row) => {
    if (!row.M_NM || !row.PLAY_DT || !row.PLAY_TIME || row.PLAY_TIME.length < 4) return [];
    return [
      {
        chain: "INDIE" as const,
        branchCode: theater.branchCode,
        branchName: theater.branchName,
        region: "서울",
        movieTitle: cleanTitle(row.M_NM),
        sourceMovieCode: row.M_ID,
        playDate: row.PLAY_DT.slice(0, 10),
        startTime: time(row.PLAY_TIME)!,
        endTime: time(row.END_TIME),
        screenName: row.TS_NM,
        format: row.SUBTITLE || undefined,
        remainingSeats: Number.isFinite(Number(row.REMAINSEAT_CNT))
          ? Number(row.REMAINSEAT_CNT)
          : undefined,
        totalSeats: Number.isFinite(Number(row.SEAT_CNT)) ? Number(row.SEAT_CNT) : undefined,
        bookingUrl: theater.bookingUrl,
        posterUrl: movieeImageUrl(row.THUMB_FILE),
      },
    ];
  });
}

export async function collectMovieeScreenings(
  theater: MovieeTheater,
  options: { days?: number; startDate?: string } = {}
): Promise<CollectedScreening[]> {
  const days = Math.max(1, Math.min(options.days ?? 8, 14));
  const start =
    options.startDate ?? new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const rows: CollectedScreening[] = [];
  for (let i = 0; i < dates.length; i += 2) {
    rows.push(
      ...(await Promise.all(dates.slice(i, i + 2).map((d) => fetchDate(theater, d)))).flat()
    );
  }
  console.log(`  ${theater.branchName} 공식 시간표: ${days}일 · ${rows.length}회차`);
  return rows;
}
