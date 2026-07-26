# cinemo - 준비 체크리스트

## API 키 & 계정 발급

- [x] **TMDB API 키 발급** — https://www.themoviedb.org 가입 → Settings → API → key 발급 ✅ 2026-07-09
- [x] **KOBIS API 키 발급** — https://kobis.or.kr/kobisopenapi 가입 → 키 신청 (개봉작 목록 조회용) ✅ 2026-07-09
- [x] **Cloudflare 계정 가입** → R2 버킷 생성 (이미지 아카이브용) ✅ 2026-07-09
- [x] **Vercel 계정 가입** — GitHub 연동 (프론트 배포용) ✅ 2026-07-09
- [x] **Turso DB 생성** — `cinemo` 데이터베이스 새로 생성 + 토큰 발급 ✅ 2026-07-09

> 키·토큰 값은 루트 `.env`에만 둔다 (변수 목록은 `.env.example`). **문서에 실값 금지.**


## 사전 조사

- [x] **CGV 이벤트 페이지 API 분석** ✅ 2026-07-09

#### CGV 이벤트 API (JSON, 인증 불필요)

| API | URL | 용도 |
|---|---|---|
| 이벤트 배너 목록 | `event.cgv.co.kr/evt/evt/evt/searchEvtBanrLst?coCd=A420&expoChnlCd=01` | 메인 배너 이벤트 |
| 이벤트 페이징 목록 | `event.cgv.co.kr/evt/evt/evt/searchEvtListForPage?coCd=A420&evntCtgryLclsCd=03&startRow=0&listCount=10` | 카테고리별 이벤트 목록 |
| 이벤트 상세 | `event.cgv.co.kr/evt/evt/evtDtl/searchEvtDtl?coCd=A420&evntNo={이벤트번호}&expoChnlCd=01` | 이벤트 상세 정보 |

- 카테고리: `01`=SPECIAL, `03`=영화(특전/굿즈), `04`=극장, `05`=제휴
- 중분류: `031`=일반, `032`=시사회, `033`=무대인사, `034`=아트하우스
- 상세 응답에 `ctgmovLst`(연결 영화), `evntStartDt`/`evntEndDt`(기간), 이미지 파일 경로 포함
- 이미지 URL: `https://cdn.cgv.co.kr/{physcFilePathnm}/{physcFnm}`
- [x] **롯데시네마 이벤트 페이지 API 분석** ✅ 2026-07-09

#### 롯데시네마 이벤트 API (JSON, 인증 불필요)

| API | URL | Method |
|---|---|---|
| 이벤트 목록 | `www.lottecinema.co.kr/LCWS/Event/EventData.aspx` | POST (multipart) |

- POST body (paramList JSON): `{"MethodName":"GetEventLists","channelType":"HO","osType":"W","EventClassificationCode":0,"PageNo":1,"PageSize":16,...}`
- 응답 필드: `EventID`, `EventName`, `ProgressStartDate`/`ProgressEndDate`, `ImageUrl`, `EventCntnt`(HTML 상세), `EventClassificationCode`
- 이미지 URL: `http://cf.lottecinema.co.kr/Media/Event/{파일명}`
- 페이징: `PageNo`, `PageSize`로 제어
- [x] **메가박스 이벤트 페이지 API 분석** ✅ 2026-07-09

#### 메가박스 이벤트 API (HTML 반환, POST)

| API | URL | Method |
|---|---|---|
| 이벤트 목록 | `www.megabox.co.kr/on/oh/ohe/Event/eventMngDiv.do` | POST (JSON body) |
| 카테고리 코드 목록 | `www.megabox.co.kr/on/oh/ohe/Event/selectEventTyCdList.do` | POST (JSON body) |

- POST body: `{"currentPage":"1","recordCountPerPage":"1000","eventStatCd":"ONG","eventDivCd":"CED01","eventTyCd":"","orderReqCd":"ONGlist"}`
- 탭 구분: `eventDivCd` — `CED01`=영화, `CED03`=메가pick
- 카테고리(영화 탭): `ZEC`=빵원쿠폰, `ZECP`=빵원쿠폰플러스, `CET03`=굿즈패키지, `POP`=포인트플러스
- **응답이 HTML** — JSON이 아니라 cheerio 등으로 파싱 필요
- HTML 구조: `<li>` → `<a data-no="이벤트번호">` → `<p class="tit">제목</p>` + `<p class="date">기간</p>` + `<img src="이미지URL">`
- 이미지 URL: `https://img.megabox.co.kr/SharedImg/event/{날짜}/{파일명}`
- 이벤트 상세: `data-no` 값으로 별도 API 호출 필요 (추가 분석 필요)

#### 굿즈 소진 현황 API

**CGV** — JSON, 수량까지 제공

| API | URL | 용도 |
|---|---|---|
| 특전 목록 | `event.cgv.co.kr/evt/saprm/saprm/searchSaprmEvtListForPage?coCd=A420&startRow=0&listCount=10` | 진행 중 특전 이벤트 목록 |
| 상품 목록 | `event.cgv.co.kr/evt/saprm/saprm/searchSaprmEvtProdList?coCd=A420&saprmEvntNo={번호}` | 해당 이벤트의 굿즈 종류 |
| 지점별 소진 현황 | `event.cgv.co.kr/evt/saprm/saprm/searchSaprmEvtTgtsiteList?coCd=A420&saprmEvntNo={번호}&spmtlNo={상품번호}` | 지점별 잔여/총수량 |

- 응답 필드: `siteNm`(지점명), `regnGrpNm`(지역), `rlInvntQty`(잔여수량), `totPayQty`(총수량), `fcfsPayYn`(선착순여부)
- 잔여 수량이 숫자로 나와서 "강남점 92/100개 남음" 표현 가능

**메가박스** — HTML, 상태값만 제공

| API | URL | Method |
|---|---|---|
| 굿즈 소진현황 | `www.megabox.co.kr/on/oh/ohe/Event/selectGoodsStockPrco.do` | POST (`eventNo`, `goodsNo`) |

- 상태값 3가지: `보유` / `소량보유` / `소진`
- 수량 숫자 없음, HTML 파싱 필요
- HTML 구조: `<li brchCd="지점코드"><a>지점명</a><span>상태</span></li>`
- [x] **TMDB 포스터 API 테스트** — 키 검증 시 동작 확인 완료 ✅ 2026-07-09

## GitHub 레포

- [x] **`cinemo` 레포 생성** (public) ✅ 2026-07-09
  - https://github.com/mameil/cinemo.git

## 나중에 (MVP 이후)

- [ ] Apify 가입 → 인스타 수집 액터 테스트
- [ ] 수집 대상 독립영화관 인스타 계정 목록 정리
