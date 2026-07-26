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
  // ── 검증 완료 (2026-07-26 일괄 — 후보 핸들 8곳이 전부 오기, 웹 검색 + Apify 프로브로 실핸들 확정) ──
  { handle: "indiespace_kr", theaterName: "인디스페이스", region: "서울", enabled: true }, // 팔로워 3.5만, 시간표 게시
  { handle: "filmforum_cinema", theaterName: "필름포럼", region: "서울", enabled: true }, // 1.5만
  { handle: "arthousemomo", theaterName: "아트하우스 모모", region: "서울", enabled: true }, // 후보 핸들이 정답이었던 유일 케이스
  { handle: "cinecube_kr", theaterName: "씨네큐브 광화문", region: "서울", enabled: true }, // 5.8만
  { handle: "emuartspace", theaterName: "에무시네마", region: "서울", enabled: true }, // 8.8만, 주간 시간표 게시
  { handle: "seoulartcinema", theaterName: "서울아트시네마", region: "서울", enabled: true }, // 07-25 정정분 검증 완료
  { handle: "deosup_artcinema", theaterName: "더숲 아트시네마", region: "서울", enabled: true }, // 1.7만
  { handle: "arirang_cine", theaterName: "아리랑시네센터", region: "서울", enabled: true }, // 6천, 공립
  { handle: "kucinema", theaterName: "KU시네마테크", region: "서울", enabled: true }, // 1.6만, 시간표 게시
  { handle: "artninecinema", theaterName: "아트나인", region: "서울", enabled: true }, // 7.3만, 시간표 게시
];
