/**
 * 씨네큐브 광화문 공식 예매처 Dtryx 시간표. (cinecube/000003)
 *
 * 2026-08-09: 자체사이트(cinecube.co.kr HTML 파싱) → Dtryx 이관. 구조화 API + 공식 포스터(Url).
 * (씨네큐브 예매가 Dtryx임을 API 극장명 CinemaNm=씨네큐브광화문 로 검증. 전용앱도 com.dtryx.cinecube)
 */

import { collectDtryxIndieScreenings } from "./momo";

export function collectCinecubeScreenings(options: {
  days?: number;
  startDate?: string;
} = {}) {
  return collectDtryxIndieScreenings(
    {
      cinemaCode: "000003",
      brandCode: "cinecube",
      branchCode: "ig-cinecube_kr",
      branchName: "씨네큐브 광화문",
      bookingUrl: "https://www.dtryx.com/cinema/main.do?BrandCd=cinecube&CinemaCd=000003",
    },
    options
  );
}
