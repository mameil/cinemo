# 상영시간표(screenings) 크롤러 작업 목록

특전 캘린더에 더해 **"날짜별 × 지점 × 시간 상영시간표 + 그 영화 보면 주는 특전"** 을 제공하기 위한
상영시간표 수집 파이프라인. 기존 이벤트/특전 파이프라인(`docs/ingest-tasks.md`)과 별개 데이터 도메인.

## 확정된 설계 결정

- **수집 범위**: 수도권 전체 (서울/경기/인천) 지점. 전국 아님.
- **데이터 도메인**: `상영 = 영화 × 지점 × 날짜 × 시간 × 상영관(2D/IMAX/4DX/자막·더빙)`
- **영화/지점 매칭**: 상영 API가 주는 체인 내부 코드 → 기존 `movies`(이름 매칭, findOrCreateMovie 재사용) / `theaters`(chain_branch_code) 로 연결
- **특전 연결**: 상영(screenings) ⨝ events/goodies (movie_id + chain + 날짜 겹침) 으로 "이 상영 보면 특전 줌" 도출

## 조사 현황 (사전 조사)

- [x] **롯데 상영시간표 API 확인** — `POST /LCWS/Ticketing/TicketingData.aspx` (MethodName `GetPlaySequence`)
  - params: `playDate`(YYYY-MM-DD), `cinemaID`("1|{DivisionCode}|{CinemaID}"), `representationMovieCode`("" = 전체)
  - 응답 `PlaySeqs`: 회차별 시간/상영관/영화/포맷/자막더빙/잔여좌석. 인증 불필요(기존 postApi 재사용 가능)
- [ ] **메가박스 상영시간표 API** — `ScheduleList.do`는 HTML 반환(오답). 실제 예매 스케줄 JSON 엔드포인트 탐색 필요
- [ ] **CGV 상영시간표 API** — 엔드포인트 탐색 필요 (curl-impersonate + HMAC 서명 적용 대상, 가장 난이도 높음)

---

## 1단계 — API 조사 완료 ✅

- [x] 메가박스: `POST /on/oh/ohc/Brch/schedulePage.do` (지점필터 키 `brchNo1`), 지점목록 `selectPlayTimeMasterList.do` (areaCd 10/30/35)
- [x] CGV: `GET api.cgv.co.kr/cnm/atkt/searchMovScnInfo` (기존 impersonate+HMAC), 극장목록 `searchAllRegionAndSite` (regnGrpCd 01/02/03)
- [x] 수도권 지점: 메가 areaCd / CGV regnGrpCd / 롯데 위경도 bbox

## 2단계 — 스키마

- [ ] `screenings` 테이블 추가 (movie_id, theater_id, chain, play_date, start_time, end_time,
      screen_name, format, subtitle_dub, source_movie_code, remaining_seats, total_seats, booking_url)
- [ ] upsert용 unique 인덱스 (chain, theater_id, play_date, start_time, screen_name, source_movie_code)
- [ ] 조회 성능용 인덱스 (play_date, theater_id / movie_id)
- [ ] `theaters` 마스터 확장 — 지금은 특전 재고 있던 지점만 있음. 수도권 전 지점을 채워야 함
      (롯데 fetchCinemaList / CGV·메가 지점목록 API)

## 3단계 — 수집·적재 (공용 계층 확장)

- [ ] `domain.ts`에 `CollectedScreening` 타입 추가
- [ ] `db/repo.ts`에 `upsertScreening` / `ingestScreenings` 추가 (movie 매칭 재사용)
- [ ] 수도권 지점 필터 (region 서울/경기/인천 기준)

## 3단계 — 수집·적재 (공용 계층 확장) ✅
- [x] `CollectedScreening` 타입 + `upsertScreening`/`ingestScreenings` (영화·지점 매칭 재사용)
- [x] rate-limit 회피 throttle(기본 200ms) + `--only=` 지점 필터

## 4단계 — 체인별 collect ✅

- [x] `lotte/schedule.ts` — GetPlaySequence, 위경도 수도권 필터 (수도권 64관 적재 검증)
- [x] `megabox/schedule.ts` — schedulePage.do(brchNo1), areaCd 필터
- [x] `cgv/schedule.ts` — searchMovScnInfo, regnGrpCd 필터
- [x] 3사 통합 "날짜×지점×시간+특전" 조회 검증 (일산/고양 데모)

## 5단계 — 오케스트레이션 + 운영 ✅

- [x] `schedule-all.ts` — 3사 상영 순차 수집·적재 오케스트레이터 (`pnpm crawl:schedule`)
      단계별 리포트 + 실패 시 exit1 + Job Summary
- [x] `.github/workflows/schedule.yml` — 매일 13시(KST) 별도 크론 (굿즈 3시간 크론과 분리)
- [x] 크론 2개 체제: 굿즈/소진(3h) + 상영시간표(하루1회)
- [x] rate-limit throttle(3사) + 구역 기본(DEFAULT_ZONE)/`--only`/`--all`/`SCHEDULE_ONLY`
- [~] **수도권 전체 매일 수집은 무료 예산(2,000분) 초과** → 기본은 구역 수집.
      전체가 필요하면 `--all` 또는 레포 var `SCHEDULE_ONLY` 조정 (예산 주의).

---

## 리스크 / 메모

- **데이터 규모**: 수도권 전 지점 × ~20편 × 8일 × 회차 → 1회 수집 수천~수만 행. 크론 부담·수집시간·DB 용량 커짐 → 주기 분리 필요.
- **예매 오픈 범위**: 영화관은 보통 1주일 앞까지만 시간표 공개 → 먼 날짜는 비어있을 수 있음(정상).
- **좌석 잔여**: 실시간 변동이 커서 수집 시점 스냅샷. 자주 갱신 아니면 부정확할 수 있음 → 좌석수는 optional로.
- **CGV 난이도**: 상영 API도 curl-impersonate + HMAC 필요. 롯데(쉬움)→메가→CGV 순 권장.
