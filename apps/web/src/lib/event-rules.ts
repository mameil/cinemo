/**
 * 특전 이벤트 노출 규칙 (조회 API 공용)
 *
 * 얼리버드/선예매 특전: DB의 이벤트 기간은 "수령 기간"(개봉~종료)이라 개봉 후에도
 * 진행 중으로 잡히지만, 획득 조건(개봉 전 예매)은 이미 닫혀 있다.
 * → 개봉일이 지난 영화의 얼리버드류 이벤트는 "오늘 보면 받는 특전"이 아니므로 숨긴다.
 * (개봉일 미상 = 미개봉 취급 → 노출 유지. KOBIS 백필로 개봉일 들어오면 자동 제외됨)
 */

const PRE_RELEASE_ONLY = /얼리버드|선\s*예매|사전\s*예매/;

/** 획득 시점이 개봉 전으로 한정되는 이벤트인가 */
export function isPreReleaseOnlyEvent(eventName: string): boolean {
  return PRE_RELEASE_ONLY.test(eventName);
}

/**
 * 기준일(date) 시점에 이 이벤트를 획득 가능한가.
 * @param releaseDate 영화 개봉일 (YYYY-MM-DD, null=미상)
 */
export function isObtainable(
  eventName: string,
  releaseDate: string | null | undefined,
  date: string
): boolean {
  if (!isPreReleaseOnlyEvent(eventName)) return true;
  if (!releaseDate) return true; // 개봉일 미상 → 미개봉 취급
  return releaseDate > date; // 개봉 전까지만 획득 가능
}

// ── 조건 ④ 포맷 부합 ──
// "4DX 포스터"는 4DX 관람 시에만 증정 — 이벤트명에 포맷 토큰이 있으면
// 그 포맷 상영에만 성립한다. (2D 상영에 4DX 포스터 배지가 붙던 버그의 원인)

const FORMAT_RULES: { token: RegExp; match: RegExp }[] = [
  { token: /4dx|mx4d/i, match: /4DX|MX4D/i },
  { token: /imax/i, match: /IMAX/i },
  // CGV는 이벤트명에 SX 약칭도 씀 ("[모아나] SX 포스터")
  { token: /screenx|(?<![a-z])sx(?![a-z])/i, match: /SCREENX/i },
  { token: /돌비|dolby/i, match: /돌비|DOLBY/i },
  { token: /울트라\s*4dx|ultra\s*4dx/i, match: /ULTRA\s*4DX/i },
];

/**
 * 이벤트명에서 요구 포맷 추출. null = 포맷 무관 (아무 상영이나 OK).
 * 반환값은 FORMAT_RULES 인덱스 키 문자열.
 */
export function requiredFormat(eventName: string): string | null {
  for (let i = 0; i < FORMAT_RULES.length; i++) {
    if (FORMAT_RULES[i].token.test(eventName)) return String(i);
  }
  return null;
}

/** 상영 포맷이 요구 포맷을 충족하는가 */
export function formatSatisfies(
  required: string | null,
  screeningFormat: string | null | undefined
): boolean {
  if (required === null) return true; // 포맷 무관 특전
  if (!screeningFormat) return false; // 포맷 요구인데 상영 포맷 미상 → 미성립
  return FORMAT_RULES[Number(required)].match.test(screeningFormat);
}
