/** KT&G 상상마당 시네마 공식 예매처 MOVIEE 시간표. (sancheong/123 — dtryx→MOVIEE 전환, 2026-08-08 실측) */

import { collectMovieeScreenings } from "./moviee";

const BASE_URL = "https://sancheong.moviee.co.kr";
const THEATER_ID = "123";

export function collectSangsangScreenings(options: { days?: number } = {}) {
  return collectMovieeScreenings(
    {
      baseUrl: BASE_URL,
      theaterId: THEATER_ID,
      branchCode: "ig-sangsangcinema",
      branchName: "KT&G 상상마당 시네마",
      bookingUrl: `${BASE_URL}/Theater/Index?thsynid=${THEATER_ID}`,
    },
    options
  );
}
