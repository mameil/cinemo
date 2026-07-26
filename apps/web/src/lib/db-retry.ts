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

/** 스냅샷 데이터(3시간 주기 크롤)용 CDN 캐시 — Turso 장애 시에도 캐시로 버팀 */
export const SNAPSHOT_CACHE_HEADERS = {
  "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
};
