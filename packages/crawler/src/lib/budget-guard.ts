/**
 * 과금 방어 가드 (2026-07-25 — "절대 과금되면 안 된다" 원칙)
 *
 * 유료 전환 위험이 있는 연동:
 *   - Apify: 무료 크레딧 $5/월 — 사용량 API로 사전 점검, 80% 초과 시 실행 중단
 *   - R2: 무료 한도(저장 10GB · 쓰기 1M/월) 초과 시 실과금 — r2.ts에서 업로드 상한/크기 제한
 *   - Gemini: 결제 미연결 상태면 초과 시 429만 발생 (과금 불가) — 콘솔에서 결제 연결 금지
 *
 * 원칙: 예산 확인이 "불가능"하면 실행하지 않는다 (fail-closed).
 */

/** Apify 월 크레딧 사용률이 이 비율을 넘으면 실행 중단 */
const APIFY_BUDGET_CUTOFF = 0.8;

/**
 * Apify 월 사용량 사전 점검 — 크레딧 80% 초과 또는 조회 실패 시 throw.
 * 모든 Apify 액터 호출 전에 부를 것.
 */
export async function assertApifyBudget(): Promise<void> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN 환경변수 누락");

  let data: {
    limits?: { maxMonthlyUsageUsd?: number };
    current?: { monthlyUsageUsd?: number };
  };
  try {
    const res = await fetch(`https://api.apify.com/v2/users/me/limits?token=${token}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = ((await res.json()) as { data: typeof data }).data;
  } catch (err) {
    // fail-closed: 예산을 확인할 수 없으면 실행하지 않는다
    throw new Error(`Apify 사용량 조회 실패(${(err as Error).message}) — 과금 방지를 위해 실행 중단`);
  }

  const max = data.limits?.maxMonthlyUsageUsd ?? 0;
  const used = data.current?.monthlyUsageUsd;
  if (max <= 0 || typeof used !== "number") {
    throw new Error("Apify 사용량 응답 형식 불명 — 과금 방지를 위해 실행 중단");
  }

  const ratio = used / max;
  console.log(`  Apify 사용량: $${used.toFixed(2)} / $${max} (${Math.round(ratio * 100)}%)`);
  if (ratio >= APIFY_BUDGET_CUTOFF) {
    throw new Error(
      `Apify 월 사용량 ${Math.round(ratio * 100)}% ≥ ${APIFY_BUDGET_CUTOFF * 100}% — 과금 방지를 위해 실행 중단 (다음 사이클에 자동 회복)`
    );
  }
}
