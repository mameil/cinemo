/** 필름포럼 공식 예매처 MOVIEE 시간표. (haman/130) */

import { collectMovieeScreenings } from "./moviee";

const BASE_URL = "https://haman.moviee.co.kr";
const THEATER_ID = "130";

export function collectFilmforumScreenings(options: { days?: number } = {}) {
  return collectMovieeScreenings(
    {
      baseUrl: BASE_URL,
      theaterId: THEATER_ID,
      branchCode: "ig-filmforum_cinema",
      branchName: "필름포럼",
      bookingUrl: `${BASE_URL}/Theater/Index?thsynid=${THEATER_ID}`,
    },
    options
  );
}
