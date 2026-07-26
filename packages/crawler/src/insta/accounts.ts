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

export const INSTA_ACCOUNTS: InstaAccount[] = [
  // ── 검증 완료 ──
  { handle: "laikacinema", theaterName: "라이카시네마", region: "서울", enabled: true },
  // 2026-07-25 검증: 후보명 ssmadang_cinema는 미존재, 실계정 sangsangcinema (팔로워 1.7만)
  { handle: "sangsangcinema", theaterName: "KT&G 상상마당 시네마", region: "서울", enabled: true },

  // ── 핸들 미검증 (후보) — 서울 서부 ──
  { handle: "indiespace_official", theaterName: "인디스페이스", region: "서울", enabled: false },
  { handle: "filmforum_kr", theaterName: "필름포럼", region: "서울", enabled: false },
  { handle: "arthousemomo", theaterName: "아트하우스 모모", region: "서울", enabled: false },

  // ── 핸들 미검증 (후보) — 도심·그 외 ──
  { handle: "cinecube_official", theaterName: "씨네큐브 광화문", region: "서울", enabled: false },
  { handle: "emucinema", theaterName: "에무시네마", region: "서울", enabled: false },
  // 실핸들 seoulartcinema로 정정 (2026-07-25 웹 확인, 미활성)
  { handle: "seoulartcinema", theaterName: "서울아트시네마", region: "서울", enabled: false },
  { handle: "theforest_artcinema", theaterName: "더숲 아트시네마", region: "서울", enabled: false },
  { handle: "arirangcine", theaterName: "아리랑시네센터", region: "서울", enabled: false },
  { handle: "kucinematheque", theaterName: "KU시네마테크", region: "서울", enabled: false },
  { handle: "artnine_official", theaterName: "아트나인", region: "서울", enabled: false },
];
