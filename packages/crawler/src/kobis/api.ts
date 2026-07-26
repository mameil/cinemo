/**
 * KOBIS(영화진흥위원회) 오픈API 클라이언트
 *
 * 개봉작 목록 및 영화 상세 정보를 수집한다.
 * 인증: 발급받은 API 키를 `key` 쿼리 파라미터로 전달 (헤더/서명 불필요)
 *
 * 엔드포인트 정리:
 * - 영화 목록: /movie/searchMovieList.json
 * - 영화 상세: /movie/searchMovieInfo.json
 * - 일별 박스오피스: /boxoffice/searchDailyBoxOfficeList.json
 *
 * 문서: https://kobis.or.kr/kobisopenapi/homepg/apiservice/searchServiceInfo.do
 */

const BASE = "http://www.kobis.or.kr/kobisopenapi/webservice/rest";

const API_KEY = process.env.KOBIS_API_KEY;
if (!API_KEY) {
  throw new Error("KOBIS_API_KEY 환경변수가 설정되지 않았습니다.");
}

// ── 타입 ────────────────────────────────────────

export interface KobisMovieListItem {
  movieCd: string;
  movieNm: string;
  movieNmEn: string;
  prdtYear: string;
  openDt: string; // YYYYMMDD (미정이면 빈 문자열)
  typeNm: string; // 장편 | 단편 | 옴니버스
  prdtStatNm: string; // 개봉 | 개봉예정 | 기타
  nationAlt: string; // 제작국가 (콤마 구분)
  genreAlt: string; // 장르 (콤마 구분)
  repNationNm: string; // 대표 제작국가
  repGenreNm: string; // 대표 장르
  directors: { peopleNm: string }[];
  companys: { companyCd: string; companyNm: string }[];
}

export interface KobisMovieInfo {
  movieCd: string;
  movieNm: string;
  movieNmEn: string;
  movieNmOg: string;
  showTm: string; // 상영시간(분)
  prdtYear: string;
  openDt: string;
  prdtStatNm: string;
  typeNm: string;
  nations: { nationNm: string }[];
  genres: { genreNm: string }[];
  directors: { peopleNm: string; peopleNmEn: string }[];
  actors: { peopleNm: string; peopleNmEn: string; cast: string; castEn: string }[];
  showTypes: { showTypeGroupNm: string; showTypeNm: string }[];
  companys: {
    companyCd: string;
    companyNm: string;
    companyNmEn: string;
    companyPartNm: string;
  }[];
  audits: { auditNo: string; watchGradeNm: string }[];
}

export interface KobisBoxOfficeItem {
  rank: string;
  movieCd: string;
  movieNm: string;
  openDt: string; // YYYY-MM-DD
  audiCnt: string; // 해당일 관객수
  audiAcc: string; // 누적 관객수
  scrnCnt: string; // 상영 스크린 수
  rankOldAndNew: string; // OLD | NEW
}

// ── API 호출 ────────────────────────────────────

async function fetchJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ key: API_KEY!, ...params });
  const url = `${BASE}${path}?${query.toString()}`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`KOBIS API HTTP ${res.status} - ${path}`);
  }

  const json = (await res.json()) as { faultInfo?: { message: string } } & T;
  if (json.faultInfo) {
    throw new Error(`KOBIS API 오류: ${json.faultInfo.message}`);
  }
  return json as T;
}

export interface MovieListOptions {
  /** 영화명 검색어 (부분 일치) */
  movieNm?: string;
  /** 개봉연도 시작 (YYYY) */
  openStartDt?: string;
  /** 개봉연도 종료 (YYYY) */
  openEndDt?: string;
  /** 제작국가: K=한국, F=외국 */
  repNationCd?: string;
  /** 영화 구분 코드 (장편 등) */
  movieTypeCd?: string;
  curPage?: number;
  itemPerPage?: number;
}

/** 영화 목록 조회 (개봉연도/국가 등 필터, 페이징) */
export async function fetchMovieList(
  opts: MovieListOptions = {}
): Promise<{ totCnt: number; list: KobisMovieListItem[] }> {
  const params: Record<string, string> = {
    curPage: String(opts.curPage ?? 1),
    itemPerPage: String(opts.itemPerPage ?? 100),
  };
  if (opts.movieNm) params.movieNm = opts.movieNm;
  if (opts.openStartDt) params.openStartDt = opts.openStartDt;
  if (opts.openEndDt) params.openEndDt = opts.openEndDt;
  if (opts.repNationCd) params.repNationCd = opts.repNationCd;
  if (opts.movieTypeCd) params.movieTypeCd = opts.movieTypeCd;

  const data = await fetchJson<{
    movieListResult: { totCnt: number; movieList: KobisMovieListItem[] };
  }>("/movie/searchMovieList.json", params);

  return {
    totCnt: data.movieListResult.totCnt,
    list: data.movieListResult.movieList,
  };
}

/** 영화 상세 정보 조회 */
export async function fetchMovieInfo(movieCd: string): Promise<KobisMovieInfo> {
  const data = await fetchJson<{
    movieInfoResult: { movieInfo: KobisMovieInfo };
  }>("/movie/searchMovieInfo.json", { movieCd });

  return data.movieInfoResult.movieInfo;
}

/** 일별 박스오피스 조회 (targetDt: YYYYMMDD) */
export async function fetchDailyBoxOffice(
  targetDt: string
): Promise<KobisBoxOfficeItem[]> {
  const data = await fetchJson<{
    boxOfficeResult: { dailyBoxOfficeList: KobisBoxOfficeItem[] };
  }>("/boxoffice/searchDailyBoxOfficeList.json", { targetDt });

  return data.boxOfficeResult.dailyBoxOfficeList;
}

// ── 유틸 ────────────────────────────────────────

/** YYYYMMDD 문자열을 YYYY-MM-DD 로 변환 (빈 값이면 그대로 반환) */
export function formatOpenDt(openDt: string): string {
  if (!/^\d{8}$/.test(openDt)) return openDt;
  return `${openDt.slice(0, 4)}-${openDt.slice(4, 6)}-${openDt.slice(6, 8)}`;
}

/**
 * 개봉 예정작만 필터링한다.
 * KOBIS 영화 목록은 과거 개봉작까지 모두 포함하므로, openDt가 기준일 이후인 항목만 추린다.
 * @param todayYmd 기준일 (YYYYMMDD)
 */
export function filterUpcoming(
  list: KobisMovieListItem[],
  todayYmd: string
): KobisMovieListItem[] {
  return list
    .filter((m) => /^\d{8}$/.test(m.openDt) && m.openDt >= todayYmd)
    .sort((a, b) => a.openDt.localeCompare(b.openDt));
}
