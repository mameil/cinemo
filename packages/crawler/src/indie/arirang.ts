/** 아리랑시네센터 공식 홈페이지가 사용하는 Dtryx 시간표. */

import { collectDtryxIndieScreenings } from "./momo";

export function collectArirangScreenings(options: {
  days?: number;
  startDate?: string;
} = {}) {
  return collectDtryxIndieScreenings({
    cinemaCode: "000088",
    brandCode: "etc",
    workGuid: "ADF5F3D5-BF7B-4449-9AA2-16858E197DDA",
    branchCode: "ig-arirang_cine",
    branchName: "아리랑시네센터",
    bookingUrl:
      "https://www.dtryx.com/reserve/movie.do?cgid=FE8EF4D2-F22D-4802-A39A-D58F23A29C1E" +
      "&CinemaCd=000088",
  }, options);
}
