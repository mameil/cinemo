import { hostname } from "os";
import { INDIE_THEATERS } from "@cinemo/shared";

/**
 * 인스타 수집 대상 — 서울 독립·예술영화관 (설계서 2026-07-22)
 *
 * enabled=false 는 핸들 미검증 상태. Apify 실행으로 핸들 확인 후 켤 것
 * (틀린 핸들은 빈 결과 또는 엉뚱한 계정을 반환하므로 반드시 수동 확인).
 */

export interface InstaAccount {
  /** 인스타그램 핸들 (@ 제외) */
  handle: string;
  theaterName: string;
  region: string;
  enabled: boolean;
}

export const INSTA_ACCOUNTS: InstaAccount[] = INDIE_THEATERS.map((theater) => ({
  ...theater,
  enabled: true,
}));

// ── 계정 분담 (shard) ─────────────────────────────
// 3대(집 맥·회사 맥·회사 데탑)가 각자 계정 1/3만 긁어 IP당 인스타 부하를 낮춘다
// (무로그인 레이트리밋·2번째 프로필 벽 완화). (2026-08-09)
export const SHARD_COUNT = 3;

/** 호스트명 → shard 인덱스. 모르는 호스트는 env INSTA_SHARD 또는 전체(폴백). */
const HOST_SHARD: Record<string, number> = {
  "KDs-MacBook-Pro.local": 0,
  "DW-KD-SHIM1-D2": 1,
  "DESKTOP-F8OH9L9.kebt.co.kr": 2,
};

/** 현재 기계의 shard — env INSTA_SHARD 우선, 없으면 호스트명 매핑, 그것도 없으면 null(=전체). */
export function currentShard(): number | null {
  const env = process.env.INSTA_SHARD;
  if (env !== undefined && env !== "") {
    const n = Number(env);
    return Number.isInteger(n) && n >= 0 ? n % SHARD_COUNT : null;
  }
  const h = HOST_SHARD[hostname()];
  return h === undefined ? null : h;
}

/** shard에 해당하는 계정만 (round-robin으로 균등 분배). null이면 전체 반환. */
export function shardAccounts(
  accounts: InstaAccount[],
  shard: number | null
): InstaAccount[] {
  if (shard === null) return accounts;
  return accounts.filter((_, i) => i % SHARD_COUNT === shard);
}
