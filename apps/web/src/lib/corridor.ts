/**
 * v1 기본 코리도(내 지역) 정의 — 일산·고양·파주 + 서울 서부.
 * screenings/movies/events API가 공유한다 (기존엔 라우트마다 중복).
 */

export const CORRIDOR_KEYWORDS = [
  "일산", "화정", "행신", "운정", "금촌", "라페스타", "킨텍스",
  "영등포", "목동", "신촌", "홍대",
  "고양스타필드", "백석",
];

/** 키워드에 걸리더라도 제외할 지점 (너무 먼 곳) */
export const CORRIDOR_EXCLUDE = [
  "위례", "문산", "부천", "월드컵경기장", "수원", "안성", "하남",
];

/** 지점명이 코리도에 속하는지 (JS 레벨 판정용) */
export function isCorridorBranch(branchName: string): boolean {
  if (CORRIDOR_EXCLUDE.some((kw) => branchName.includes(kw))) return false;
  return CORRIDOR_KEYWORDS.some((kw) => branchName.includes(kw));
}
