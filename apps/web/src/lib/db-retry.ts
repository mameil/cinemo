/**
 * DB 조회 재시도 — Turso 순간 커넥트 타임아웃 흡수 (2026-07-19 장애로 도입).
 * 읽기 쿼리는 멱등이므로 재시도 안전. 크롤러 withWriteRetry와 같은 철학.
 */
export async function withDbRetry<T>(fn: () => PromiseLike<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 500 * i)); // 0.5s, 1s
    }
  }
  throw lastErr;
}

/**
 * 읽기 전용 스냅샷 API 캐시.
 * 브라우저에는 저장하지 않고 공유 CDN에서 5분 재사용하며, DB 순간 장애 때는
 * 최대 1시간 기존 응답을 제공한다. 관리자 쓰기 API에는 사용하지 않는다.
 */
export const SNAPSHOT_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=3600",
};
