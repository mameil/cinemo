/** 아트나인 공식 예매처 Dtryx 시간표. (indieart/000069 — 2026-08-08 실측) */

import { collectDtryxIndieScreenings } from "./momo";

export function collectArtnineScreenings(options: {
  days?: number;
  startDate?: string;
} = {}) {
  return collectDtryxIndieScreenings(
    {
      cinemaCode: "000069",
      brandCode: "indieart",
      branchCode: "ig-artninecinema",
      branchName: "아트나인",
      bookingUrl: "https://www.dtryx.com/cinema/main.do?BrandCd=indieart&CinemaCd=000069",
    },
    options
  );
}
