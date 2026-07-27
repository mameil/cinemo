/**
 * KOBIS/TMDB 백필 재시도 정책 (2026-07-27 경량 크론 타임아웃 사고 후속)
 *
 * 문제: 미매칭 영화(비영화 편성 포함)를 매 실행 전부 재검색 → 실행 시간이
 * 미매칭 수에 비례해 무한 성장 (건당 API 왕복 + 레이트리밋 sleep).
 *
 * 정책:
 *   - 비영화 편성(스포츠 중계·콘서트 실황·팬미팅 등)은 API 호출 없이 제외
 *   - 미매칭 영화는 movies.match_checked_at 마커로 RECHECK_DAYS에 1회만 재시도
 *     (독립영화·신작은 KOBIS 등재가 늦을 수 있어 영구 제외는 하지 않는다)
 *   - 같은 파이프라인 실행 안에서는 KOBIS 패스가 찍은 마커를 TMDB 패스가
 *     무시해야 하므로, RUN_STARTED_AT 이후 마커는 "이번 실행 것"으로 보고 통과
 */

/** 미매칭 재시도 주기 (일) */
export const RECHECK_DAYS = 7;

/** 프로세스 시작 시각 — 같은 실행 내 패스 간 마커 공유 기준 */
export const RUN_STARTED_AT = new Date().toISOString();

/**
 * 영화가 아닌 특별관 편성 패턴 — KOBIS/TMDB에 영원히 없을 제목들.
 * 보수적으로 유지할 것: 오탐이면 실제 영화가 포스터를 영영 못 받는다.
 */
const NONFILM_PATTERN =
  /(중계|팬미팅|무대인사|라이브 ?뷰잉|Live Viewing|월드컵|KBO|프로야구|리그전|콘서트|CONCERT|E-SPORTS|LCK)/i;

export function isNonFilm(title: string): boolean {
  return NONFILM_PATTERN.test(title);
}

/** 이번 실행에서 매칭을 시도해야 하는가 */
export function shouldAttemptMatch(matchCheckedAt: string | null): boolean {
  if (!matchCheckedAt) return true; // 한 번도 시도 안 함 (신규)
  if (matchCheckedAt >= RUN_STARTED_AT) return true; // 이번 실행의 앞 패스가 찍은 마커
  const cutoff = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  return matchCheckedAt < cutoff; // 주기 경과 → 재시도
}
