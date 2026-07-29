# cinemo 개발 작업 사항

## Phase 1 — 프로젝트 기반

- [x] 모노레포 의존성 설치 및 TypeScript 설정 확인
- [x] DB 스키마 코드 작성 (Drizzle ORM)
- [x] Turso DB에 마이그레이션 실행
- [x] .env 설정 및 DB 연결 확인

## Phase 2 — 크롤러 (데이터 수집)

### CGV 크롤러 ✅
- [x] CGV 이벤트 목록 크롤러
- [x] CGV 이벤트 상세 크롤러
- [x] CGV 굿즈 소진 현황 크롤러
- [x] CGV API 문서화 (`packages/crawler/src/cgv/README.md`)

### 메가박스 크롤러 ✅
- [x] 메가박스 이벤트 크롤러 (HTML 파싱 - cheerio)
- [x] 메가박스 굿즈 소진 현황 크롤러
- [x] 메가박스 API 문서화 (`packages/crawler/src/megabox/README.md`)

### 롯데시네마 크롤러 ✅
- [x] 롯데시네마 이벤트 크롤러
- [x] 롯데시네마 굿즈/시사회 크롤러
- [x] 롯데시네마 API 문서화 (`packages/crawler/src/lotte/README.md`)

### KOBIS 연동 ✅
- [x] KOBIS 개봉작 목록 크롤러 (영화 목록 + 개봉 예정작 필터)
- [x] KOBIS 영화 상세 크롤러 (감독/배우/등급/상영시간)
- [x] KOBIS 일별 박스오피스 크롤러
- [x] KOBIS API 문서화 (`packages/crawler/src/kobis/README.md`)

### 기타
- [x] TMDB 포스터 자동 연동 (`packages/shared/src/tmdb.ts` + `packages/crawler/src/tmdb-sync.ts`)
- [ ] GitHub Actions 크론 워크플로우

### 독립영화관 상영시간표

> 기존 `schedule-all.ts`/`schedule.yml`에 `INDIE` 단계로 통합한다.
> 공식 시간표·예매 페이지를 1순위로 사용하고, 인스타 시간표 이미지는 보조/폴백으로 유지한다.

- [x] 인스타 시간표 이미지 추출: 라이카·상상마당·KU·아트나인
- [x] 시드 `raw_posts` 시간표 백필 및 만료 이미지 재수집
- [x] 서울 v1 대상 12관을 극장 필터/DB에 상시 등록
- [x] `collectIndieScreenings()` 오케스트레이터 작성 후 기존 `schedule-all.ts`의 `INDIE` stage로 연결
- [x] 씨네큐브 공식 날짜별 시간표 수집 (운영 도메인 서버 HTML, 영화명·시간·상영관)
- [x] 에무시네마 공식 홈페이지 주간 시간표 이미지 수집 (Dtryx 403 시 홈페이지 고정 게시물)
- [x] 필름포럼 공식 예매처 MOVIEE 날짜별 시간표 API 수집
- [x] 인디스페이스 공식 홈페이지 최신 주간 시간표 이미지 수집
- [x] 아트하우스 모모 공식 Dtryx 날짜별 시간표 API 수집
- [x] 서울아트시네마 공식 프로그램 시간표 HTML 수집
- [x] 더숲 아트시네마 공식 Dtryx 날짜별 시간표 API 수집
- [x] 아리랑시네센터 공식 홈페이지 연동 Dtryx 시간표 API 수집
- [ ] 공식 소스 장애 시 인스타/R2 이미지 폴백 및 극장별 실패 격리
- [ ] 12관 × 오늘~7일 회차 커버리지 검증 및 GitHub Actions 요약에 관별 수집 건수 표시

## Phase 3 — 웹 (프론트엔드)

> 각 API는 `docs/api-spec.yaml`에 OpenAPI 스펙을 먼저 정의한 후 구현

- [ ] Next.js 프로젝트 초기 세팅
- [ ] `GET /api/calendar` — 캘린더 뷰 (주간/일별 특전 요약)
- [ ] `GET /api/events` — 특전 이벤트 목록 (날짜/기간 필터)
- [ ] `GET /api/events/:id` — 이벤트 상세 + 굿즈 목록
- [ ] `GET /api/movies` — 영화 목록
- [ ] `GET /api/movies/:id` — 영화 상세 + 관련 이벤트
- [ ] `GET /api/goods-stock/:goodieId` — 굿즈 지점별 소진 현황
- [ ] 주간/일별 캘린더 UI
- [ ] 영화 카드 (포스터 + 굿즈 목록)
- [ ] 굿즈 소진 현황 표시 UI
- [ ] PWA 설정
- [ ] Vercel 배포

## Phase 4 — 독립영화관 + 고도화

- [x] Apify 인스타 수집 연동
- [x] LLM 비전 파싱 파이프라인
- [ ] 독립영화관 12관 공식 상영시간표 수집 (`schedule.yml` 통합; Phase 2 세부 목록 참조)
- [ ] 관심 영화 알림 (텔레그램/디스코드)
