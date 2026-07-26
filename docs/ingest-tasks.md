# 크롤러 → 정규화 → DB 적재 파이프라인 작업 목록

크롤러가 fetch만 하고 `console.log`로 끝나는 상태를, **정규화 도메인 객체로 변환해 DB에 upsert**하는 파이프라인으로 완성한다.

---

## ▶ 다음 세션 시작 작업 (2026-07-13~) — 메가박스 OT 소진현황

**요청**: 메가박스 **오리지널 티켓(OT)** 의 소진률/소진현황이 안 나옴 → 수집 보강.

**현 상태 진단 (2026-07-12 기준)**:
- 메가 굿즈 20개 = **타입이 기타 10 / 포스터 10 뿐, OT(오리지널 티켓) 0개** (아예 안 잡힘)
- 메가 소진현황 118행 존재하지만 OT는 없음 (참고: CGV 소진현황 724행)
- 즉 **메가 OT 이벤트/굿즈 자체를 우리 크롤이 수집 못 하는 상태**

**조사 포인트 (내일 착수)**:
1. 메가 OT가 우리가 긁는 탭(영화 특전 `eventDivCd=CED01`) 밖에 있는지 — 다른 이벤트 탭/카테고리 확인
2. OT 소진현황이 굿즈 버튼(`data-pn`) 방식이 아닌 다른 UI/엔드포인트인지 (`selectGoodsStockPrco.do` 외)
3. 필요 시 `megabox/collect.ts` + `megabox/api.ts`에 OT 이벤트·굿즈·소진 수집 추가
   - 참고: `packages/crawler/src/megabox/` (기존 이벤트/굿즈/소진 크롤), `docs/TODO.md`의 메가 API 분석
- [ ] 메가 OT 이벤트/굿즈 소스 위치 확인 → collect 보강 → 소진현황 적재 → 검증

> UI 목업(`apps/web/mock/movie-detail.ts`)엔 메가 소진현황이 선반영돼 있어, 데이터만 붙으면 화면은 그대로 동작.

---

## 확정된 설계 결정

- **영화 매칭**: 이벤트 영화명으로 `movies` 즉석 생성(upsert) → KOBIS코드/TMDB 포스터는 이름 매칭으로 백필
- **파이프라인**: 단일 패스 정규화 + `raw_posts`에 원본 JSON 아카이빙
- **범위/순서**: 공용 계층 + CGV end-to-end 먼저 → 롯데/메가/KOBIS 복제
- **구조**: 각 크롤러는 정규화 객체를 뱉는 `collect()`만 구현, 적재는 공용 `ingest()`가 담당

---

## 1단계 — 스키마 마이그레이션 (upsert 기반 마련) ✅

- [x] `events`에 unique 인덱스 (chain, source_event_id) 추가
- [x] `goodies`에 unique 인덱스 (event_id, source_goods_id) 추가
- [x] `theaters`에 unique 인덱스 (chain, chain_branch_code) 추가
- [x] `goods_stock`에 unique 인덱스 (goodie_id, theater_id) 추가
- [x] `movies`에 title / kobis_code 인덱스 추가
- [x] `drizzle-kit generate`로 마이그레이션 생성 (`drizzle/0001_silky_robbie_robertson.sql`)
- [x] Turso에 반영 + 확인 (인덱스 6개 생성 검증 완료 — `push` 사용, 초기 세팅과 동일 방식)

## 2단계 — 공용 적재 계층 ✅

- [x] `domain.ts` — 공통 정규화 타입 정의 (CollectedEvent / CollectedGoodie / CollectedStock)
- [x] `db/repo.ts` — `saveRaw()` (raw_posts 원본 저장)
- [x] `db/movie-match.ts` — `findOrCreateMovie(title)` (제목 정규화 + 조회/생성)
- [x] `db/repo.ts` — `upsertTheater()`
- [x] `db/repo.ts` — `upsertEvent()`
- [x] `db/repo.ts` — `upsertGoodie()`
- [x] `db/repo.ts` — `upsertStock()`
- [x] 굿즈 `type` 분류 휴리스틱 (포스터 / TTT / OT / 기타) — `classifyGoodieType()`
- [x] `db/repo.ts` — `ingest(chain, events)` 오케스트레이션 함수
- [x] 합성 데이터 스모크 테스트 — 적재/멱등성/조회/정리 전부 검증 완료

## 3단계 — CGV end-to-end ✅

- [x] `cgv/collect.ts` — 특전(saprm) 흐름을 주 소스로 이벤트/굿즈/소진현황 매핑
- [x] 이벤트명/상품명에서 영화 제목 추출 (best-effort, 선두 [대괄호])
- [x] 소진현황(siteNo/expoSiteNm/regnGrpNm)에서 `theaters` 자동 채움
- [x] `cgv/index.ts` 러너 — `collect()` → `ingest()` 연결 (`--dry`/`--max=N` 지원)
- [x] 실제 DB 적재 확인 — events 35 / goodies 34 / stock 639 / theaters 79 / movies 22(dedup)
- [x] **CGV Cloudflare 우회** — 일반 curl이 403 차단됨 → `curl-impersonate`(Chrome 131 TLS)로 교체.
      바이너리는 `~/.local/bin/curl-impersonate` (env `CURL_IMPERSONATE_BIN`로 경로 지정)

## 4단계 — 나머지 체인 복제 ✅

- [x] `lotte/collect.ts` — 굿즈 카테고리(20) + 상세 MovieName + <꺾쇠> 영화명 추출 (소진현황 API 없어 goodies 없음)
- [x] `lotte/api.ts` 기존 타입 에러(TS2352) 수정
- [x] `megabox/collect.ts` — 이벤트→굿즈→소진현황 (<꺾쇠> 영화명, 상태값만/수량 null, "준비중" 제외)
- [x] `kobis-backfill.ts` — movies의 kobis_code/release_date 백필 (이름 매칭, `--dry` 지원)
- [x] 실적재 검증 — 이벤트 100(CGV35/LOTTE39/MEGA26) / movies 37(교차 dedup) / kobis 29건 채움

## 5단계 — 오케스트레이터 + 백필 ✅

- [x] `src/index.ts` — 전 체인 collect→ingest 순차 실행 (에러 격리, `--max=N`/`--skip-backfill`)
- [x] KOBIS 백필 + 기존 `tmdb-sync` 연결 (`backfill`/`syncMovies` export + `require.main` 가드)
- [x] `pnpm crawl` = [3사 수집·적재 → KOBIS 백필 → TMDB 포스터] 한 방 실행
- [x] 전체 파이프라인 완주 검증 — 이벤트 100 / 굿즈 54 / 소진 737 / 지점 123 / 영화 37(포스터 32·KOBIS 29)

---

## 2026-07-24 — CGV 이미지 매칭 5차(기획전 우산형) 추가

마녀배달부 키키 특전(신촌아트레온)의 이미지가 비어 있다는 리포트 → 원인: 신촌아트레온이
지브리 여러 편의 특전을 "[월간신촌] 재패니메이션 컬렉션 VOL.02 (특전 공개_스튜디오 지브리)"
기획전 하나로 묶어 올림. 특전명 `[마녀배달부 키키]_A3포스터`와 겹치는 단어가 없고 상세 본문에도
영화명 텍스트가 없어 (이미지 안에만 존재) **이름 기반 1~4차 매칭이 원천 불가능한 유형**.

대응: 5차 매칭 추가 — 이름 매칭 전부 실패 시, 일반 이벤트 중 ①이벤트명에 "특전" 포함
②기간 겹침 ③**진행 극장 집합이 재고 극장 집합과 완전 일치**하면 이미지 차용
("이미지 없음 > 그럴듯한 오이미지" 원칙 유지 수준의 좁은 조건).
우산 이벤트는 피드에 그대로 남기고 여러 특전(키키·모노노케)이 공유.

결과: 이미지 매칭 28→30/35 (우산 2건). 잔여 5건(모아나 SX, 미니언즈 XTRA 4종)은
CGV에 이미지 소스 자체가 없음 — 미제공 표기가 정답인 상태.

## 별도 TODO (나중에 결정/작업)

- [ ] **굿즈명이 영화로 오추출되는 케이스 정리** — best-effort 영화명 추출이 굿즈/키링 이름을 영화로 만드는 경우 있음 (예: "민들레마음 인형 키링", "메이플스토리 키캡 키링"). 이런 행은 TMDB/KOBIS 매칭도 실패하므로, "이벤트에 굿즈가 없고 KOBIS/TMDB 매칭도 실패한 movies"를 주기적으로 정리하거나 추출 필터를 강화.

- [ ] **굿즈 개별 이미지 확보** — 현재 크롤러는 이벤트 배너 이미지만 확실히 확보됨. 굿즈별(오티/B2포스터 등) 개별 사진은 소스 API가 구조화 형태로 주지 않음 (CGV 상품 응답에 이미지 필드 없음, 메가 굿즈 버튼에 이미지 없음, 롯데는 상세 HTML `EventCntnt` 본문에 이미지 임베드). 상세 페이지 HTML 파싱 + 굿즈 매칭 필요.
  - 1차 방침: 이벤트 배너 이미지로 대체 (배너에 특전들이 합성돼 나오는 경우 많음)
  - CGV 단계에서 개별 이미지 확보 가능 범위 짧게 조사 후 확장 여부 결정

## 나중 개선사항 (명시만)

- [ ] **화면에 마지막 refresh 시각 표시** — 배치가 언제 돌았는지 UI에 노출. `MAX(goods_stock.updated_at)`로 도출 가능하거나, 별도 `crawl_runs`(또는 메타) 테이블 추가 고려.
- [ ] **사용자 수동 refresh** — 화면에서 직접 재수집 트리거. GitHub Actions `workflow_dispatch`를 API로 호출하거나, 별도 온디맨드 엔드포인트.
- [ ] **매 실행 결과 알림 (성공/실패 모두 + 데이터 레벨 상세)** — 희망사항. 현재 GitHub 기본 알림은 잡 실패 시에만 오고 성공/내용 커스터마이징 불가. 원하는 것: (1) 성공해도 "성공했다" 알림, (2) TMDB 포스터 매칭 실패한 영화 목록처럼 **데이터 레벨 이슈**까지 알림. 구현하려면 Telegram/Discord/Slack webhook 스텝 추가 + `syncMovies`/`backfill`이 결과(매칭/실패 건수, 실패 제목)를 반환하도록 수정 필요. 채널 미정으로 보류.
- [ ] **레포 public 전환** — Actions 무제한 확보용. 단 사전 필수: (1) 노출된 키 전부 재발급, (2) `docs/TODO.md` 등에서 실제 값 제거, (3) git 히스토리 세탁(키가 `890b2b5`부터 존재). 지금은 private 유지.

## 배치 운영 결정 (현재)

- 레포 **private 유지** → Actions 무료 2,000분/월 예산 안에서 운영
- **크론 재배치 (2026-07-25)** — 7월에 무료 2,000분 거의 소진 발견 (3h 균일 크론 = 월 ~2,300분).
  3사 업로드 시간 실측(CGV 상세 ntcStartDt 60건 + 특전 first-seen 분포) 결과:
  CGV 58%가 **자정 정각 노출**(예약 게시), 롯데·메가 **11~12시 피크** 후 저녁까지 산발, **새벽 0~9시 신규 없음**.
  → 새벽 크롤 제거, 업로드 시간대 정렬: **풀 크롤 KST 9:30** (자정 노출분+오전 정리) + **경량(특전+재고) 12:30/15:30/18:30/21:30**.
  일 ~58분 → 월 ~1,740분 (한도 87%). 여유가 더 필요하면 다음 단계는 레포 public 전환(무제한)
- 수동 실행은 `workflow_dispatch`로 언제든 가능 (풀 크롤로 동작)

## 리스크 메모

- **CGV 영화 연결**: saprm 흐름엔 명시적 영화코드 없음 → 이름 추출 부정확 가능, 1차엔 best-effort (movieId null 허용)
- **메가 소진현황**: 수량 없이 상태값만 → remainingQty null 수용
- **지점 매칭**: 체인별 코드 상이 → theaters는 체인별 분리 관리 (교차 통합 안 함)
