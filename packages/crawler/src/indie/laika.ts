/**
 * 라이카시네마 공식 예매처 Dtryx 시간표.
 *
 * 그동안 인스타 시간표 이미지에만 의존해 다음 주 편성이 늦게(또는 아예 안) 잡혔는데,
 * 라이카 예매가 Dtryx(spacedog/000072)로 연결되는 걸 확인(2026-08-08). 기존 Dtryx 수집기
 * 재사용으로 공식 이관. WorkGuID는 이 timetable API에선 검증 안 함(빈값·타 극장 GUID로도
 * 동일 응답 — 실측) → 생략.
 */

import { collectDtryxIndieScreenings } from "./momo";

export function collectLaikaScreenings(options: {
  days?: number;
  startDate?: string;
} = {}) {
  return collectDtryxIndieScreenings(
    {
      cinemaCode: "000072",
      brandCode: "spacedog",
      branchCode: "ig-laikacinema", // 기존 theater 레코드(인스타 계정)와 동일 키로 연결
      branchName: "라이카시네마",
      bookingUrl: "https://www.dtryx.com/cinema/main.do?BrandCd=spacedog&CinemaCd=000072",
    },
    options
  );
}
