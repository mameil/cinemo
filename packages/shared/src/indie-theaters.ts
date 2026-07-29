/**
 * 서울 독립·예술영화관 v1 수집 대상.
 *
 * 게시물/상영 회차 유무와 관계없이 웹의 극장 필터에 표시하기 위한 공통 카탈로그다.
 * handle은 INDIE 지점 코드(`ig-${handle}`)와 인스타 수집 계정에 함께 사용한다.
 */
export interface IndieTheater {
  handle: string;
  theaterName: string;
  region: string;
}

export const INDIE_THEATERS: IndieTheater[] = [
  { handle: "laikacinema", theaterName: "라이카시네마", region: "서울" },
  { handle: "sangsangcinema", theaterName: "KT&G 상상마당 시네마", region: "서울" },
  { handle: "indiespace_kr", theaterName: "인디스페이스", region: "서울" },
  { handle: "filmforum_cinema", theaterName: "필름포럼", region: "서울" },
  { handle: "arthousemomo", theaterName: "아트하우스 모모", region: "서울" },
  { handle: "cinecube_kr", theaterName: "씨네큐브 광화문", region: "서울" },
  { handle: "emuartspace", theaterName: "에무시네마", region: "서울" },
  { handle: "seoulartcinema", theaterName: "서울아트시네마", region: "서울" },
  { handle: "deosup_artcinema", theaterName: "더숲 아트시네마", region: "서울" },
  { handle: "arirang_cine", theaterName: "아리랑시네센터", region: "서울" },
  { handle: "kucinema", theaterName: "KU시네마테크", region: "서울" },
  { handle: "artninecinema", theaterName: "아트나인", region: "서울" },
];
