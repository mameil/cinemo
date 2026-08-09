/**
 * 에무시네마 공식 예매처 Dtryx 시간표. (indieart/000069)
 *
 * 2026-08-09: 자체사이트(주간 이미지 Gemini OCR) → Dtryx 이관. 구조화 API + 공식 포스터(Url)로
 * 훨씬 안정적. (에무 예매가 Dtryx임을 API 극장명 CinemaNm=에무시네마 로 검증)
 */

import { collectDtryxIndieScreenings } from "./momo";

export function collectEmuScreenings(options: {
  days?: number;
  startDate?: string;
} = {}) {
  return collectDtryxIndieScreenings(
    {
      cinemaCode: "000069",
      brandCode: "indieart",
      branchCode: "ig-emuartspace",
      branchName: "에무시네마",
      bookingUrl: "https://www.dtryx.com/cinema/main.do?BrandCd=indieart&CinemaCd=000069",
    },
    options
  );
}
