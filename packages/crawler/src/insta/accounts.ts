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
