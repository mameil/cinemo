# KOBIS 크롤러

## 개요

KOBIS(영화진흥위원회) 오픈API를 호출하여 **개봉작 목록**, **영화 상세 정보**, **일별 박스오피스**를 수집한다.
체인 3사 크롤러가 수집한 이벤트/굿즈를 실제 영화(`movies` 테이블)와 매칭하기 위한 기준 데이터 소스다.

## 실행 방법

```bash
pnpm --filter @cinemo/crawler kobis
```

## API 인증

발급받은 API 키를 `key` 쿼리 파라미터로 전달한다. 별도의 헤더·서명·토큰이 필요 없다.

- 환경변수 `KOBIS_API_KEY` 로 주입 (`.env` 참고)
- 문서: https://kobis.or.kr/kobisopenapi/homepg/apiservice/searchServiceInfo.do

## API 엔드포인트

Base: `http://www.kobis.or.kr/kobisopenapi/webservice/rest`

| 함수 | Path | 용도 |
|---|---|---|
| `fetchMovieList()` | `/movie/searchMovieList.json` | 영화 목록 (개봉연도/국가 필터, 페이징) |
| `fetchMovieInfo()` | `/movie/searchMovieInfo.json` | 영화 상세 (감독·배우·등급·상영시간) |
| `fetchDailyBoxOffice()` | `/boxoffice/searchDailyBoxOfficeList.json` | 일별 박스오피스 TOP 10 |

## 주요 파라미터

### 영화 목록 (`fetchMovieList`)

| 파라미터 | 설명 |
|---|---|
| `openStartDt` / `openEndDt` | 개봉연도 범위 (YYYY) |
| `repNationCd` | 제작국가 — `K`=한국, `F`=외국 |
| `movieTypeCd` | 영화 구분 코드 |
| `curPage` / `itemPerPage` | 페이징 (기본 1페이지 / 100건) |

### 일별 박스오피스 (`fetchDailyBoxOffice`)

| 파라미터 | 설명 |
|---|---|
| `targetDt` | 조회 기준일 (YYYYMMDD) |

## 응답 필드

### 영화 목록 항목 (`KobisMovieListItem`)

| 필드 | 설명 |
|---|---|
| `movieCd` | KOBIS 영화 코드 (→ `movies.kobisCode`) |
| `movieNm` / `movieNmEn` | 영화명 (국문/영문) |
| `openDt` | 개봉일 (YYYYMMDD, 미정이면 빈 문자열) |
| `prdtStatNm` | 제작 상태 — `개봉` / `개봉예정` / `기타` |
| `repNationNm` / `repGenreNm` | 대표 제작국가 / 대표 장르 |
| `directors[]` | 감독 목록 |

### 영화 상세 (`KobisMovieInfo`)

`showTm`(상영시간, 분), `movieNmOg`(원제), `nations[]`, `genres[]`, `actors[]`(배역 포함),
`showTypes[]`(상영형태), `companys[]`(제작/배급사), `audits[]`(관람등급) 등을 추가로 제공한다.

## 주의사항

- **영화 목록은 과거 개봉작까지 전부 포함**한다. 개봉 예정작만 필요하면 `filterUpcoming(list, todayYmd)` 로
  `openDt`가 기준일 이후인 항목만 추린다.
- `openDt`는 **미정인 경우 빈 문자열**로 내려온다. 날짜 파싱 전 형식 검사가 필요하다.
- 영화 목록 응답의 `directors`/`companys`는 상세(`fetchMovieInfo`)보다 축약되어 있고 비어있을 수 있다.
  감독·배우 등 상세 정보는 `movieCd`로 별도 조회한다.
- Base URL이 **`http`** 다 (KOBIS는 https 미지원 구간이 있음).

## TODO (DB 연동 시)

- [ ] `movieList` → `movies` upsert (`kobisCode` 기준 중복 제거)
- [ ] 체인 이벤트의 영화명 ↔ `movies.title` 매칭 로직
- [ ] TMDB 포스터 연동 (`movieNmEn` + `openDt` 로 TMDB 검색 → `posterUrl`)
