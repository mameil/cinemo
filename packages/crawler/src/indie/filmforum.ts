/** 필름포럼 공식 예매처 MOVIEE 날짜별 시간표 API. */

import type { CollectedScreening } from "../domain";

const BASE_URL = "https://haman.moviee.co.kr";
const THEATER_ID = "130";
const BOOKING_URL = `${BASE_URL}/Theater/Index?thsynid=${THEATER_ID}`;

interface MovieeRow {
  PT_ID?: string;
  TS_NM?: string;
  PLAY_TIME?: string;
  END_TIME?: string;
  PLAY_DT?: string;
  M_ID?: string;
  M_NM?: string;
  SUBTITLE?: string;
  SEAT_CNT?: string;
  REMAINSEAT_CNT?: string;
  THUMB_FILE?: string; // 포스터 썸네일 파일명 — movie-img.moviee.co.kr/DisplayImage?key= 로 서빙
}

/** MOVIEE 썸네일 파일명 → 이미지 URL (프론트 번들 역추적으로 확인한 패턴, 2026-08-02) */
function movieeImageUrl(file?: string): string | undefined {
  return file?.trim() ? `https://movie-img.moviee.co.kr/DisplayImage?key=${file.trim()}` : undefined;
}

function cleanTitle(value: string): string {
  const title = value.replace(/\((?:2D|3D|자막|더빙)\)\s*$/i, "").trim();
  // 예매처에 간혹 영화 제목 뒤 소개문이 붙는다. 콜론 앞은 정식 제목인 경우가 대부분이다.
  return title.length > 80 && title.includes(" : ") ? title.split(" : ", 1)[0].trim() : title;
}

async function fetchRows(date: string): Promise<CollectedScreening[]> {
  const params = new URLSearchParams({
    tId: THEATER_ID,
    mId: "",
    playDt: date,
    ntId: "",
    gId: "",
  });
  const res = await fetch(`${BASE_URL}/api/TicketApi/GetPlayTimeList?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`필름포럼 MOVIEE HTTP ${res.status} (${date})`);
  const body = await res.json() as {
    ResCd?: string;
    ResMsg?: string;
    ResData?: { Table?: MovieeRow[] };
  };
  if (body.ResCd !== "00" && body.ResCd !== "01") {
    throw new Error(`필름포럼 MOVIEE 오류: ${body.ResMsg ?? body.ResCd}`);
  }
  return (body.ResData?.Table ?? []).flatMap((row) => {
    if (!row.M_NM || !row.PLAY_DT || !row.PLAY_TIME || row.PLAY_TIME.length < 4) return [];
    const time = (value?: string) =>
      value && value.length >= 4 ? `${value.slice(0, 2)}:${value.slice(2, 4)}` : undefined;
    return [{
      chain: "INDIE" as const,
      branchCode: "ig-filmforum_cinema",
      branchName: "필름포럼",
      region: "서울",
      movieTitle: cleanTitle(row.M_NM),
      sourceMovieCode: row.M_ID,
      playDate: row.PLAY_DT.slice(0, 10),
      startTime: time(row.PLAY_TIME)!,
      endTime: time(row.END_TIME),
      screenName: row.TS_NM,
      format: row.SUBTITLE || undefined,
      remainingSeats: Number.isFinite(Number(row.REMAINSEAT_CNT)) ? Number(row.REMAINSEAT_CNT) : undefined,
      totalSeats: Number.isFinite(Number(row.SEAT_CNT)) ? Number(row.SEAT_CNT) : undefined,
      bookingUrl: BOOKING_URL,
      posterUrl: movieeImageUrl(row.THUMB_FILE), // TMDB 미등재작(합본·단편 등) 포스터 폴백
    }];
  });
}

export async function collectFilmforumScreenings(options: { days?: number } = {}): Promise<CollectedScreening[]> {
  const days = Math.max(1, Math.min(options.days ?? 8, 14));
  const dateParams = new URLSearchParams({
    tIdList: THEATER_ID,
    mId: "",
    groupCd: "-1",
    mode: "0",
    gId: "",
    pId: "Y24",
  });
  const res = await fetch(`${BASE_URL}/api/TicketApi/GetPlayDateList?${dateParams}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`필름포럼 상영일 API HTTP ${res.status}`);
  const body = await res.json() as { ResData?: { Table?: Array<{ PLAY_DT?: string }> } };
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const dates = (body.ResData?.Table ?? [])
    .map((row) => row.PLAY_DT)
    .filter((date): date is string => Boolean(date && date >= today))
    .slice(0, days);
  if (!dates.length) throw new Error("필름포럼 공식 예매 가능일 없음");
  const rows: CollectedScreening[] = [];
  for (let i = 0; i < dates.length; i += 2) {
    rows.push(...(await Promise.all(dates.slice(i, i + 2).map(fetchRows))).flat());
  }
  console.log(`  필름포럼 공식 시간표: ${dates.length}일 · ${rows.length}회차`);
  return rows;
}
