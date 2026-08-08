/** KU시네마테크 공식 예매처 MOVIEE 시간표. (sancheong/121 — 무비애 전환, 2026-08-08 실측) */

import { collectMovieeScreenings } from "./moviee";

const BASE_URL = "https://sancheong.moviee.co.kr";
const THEATER_ID = "121";

export function collectKuScreenings(options: { days?: number } = {}) {
  return collectMovieeScreenings(
    {
      baseUrl: BASE_URL,
      theaterId: THEATER_ID,
      branchCode: "ig-kucinema",
      branchName: "KU시네마테크",
      bookingUrl: `${BASE_URL}/Theater/Index?thsynid=${THEATER_ID}`,
    },
    options
  );
}
