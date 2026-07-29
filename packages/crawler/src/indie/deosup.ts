/** 더숲 아트시네마 공식 Dtryx 시간표. */

import { collectDtryxIndieScreenings } from "./momo";

export function collectDeosupScreenings(options: {
  days?: number;
  startDate?: string;
} = {}) {
  return collectDtryxIndieScreenings({
    cinemaCode: "000065",
    branchCode: "ig-deosup_artcinema",
    branchName: "더숲 아트시네마",
    bookingUrl:
      "https://www.dtryx.com/cinema/main.do?BrandCd=indieart&CinemaCd=000065" +
      "&cgid=FE8EF4D2-F22D-4802-A39A-D58F23A29C1E",
  }, options);
}
