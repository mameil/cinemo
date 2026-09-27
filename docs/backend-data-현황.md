# 백엔드 데이터 현황

> 라이브 Turso(SQLite) 직접 조회 스냅샷 · 2026-09-27
> 프론트 리뉴얼 시 "데이터가 실제로 뭐가 있는지"의 기준 문서.
> 대시보드 아티팩트: https://claude.ai/code/artifact/ba824ed5-1b6c-4886-bd9f-58b8fa04c496

## 요약 (KPI)

| 지표 | 값 |
|---|---:|
| 영화 (movies) | 645 |
| 영화관 (theaters) | 381 |
| 활성 특전 (오늘 기간 내) | 339 |
| 상영 회차 (screenings) | 8,416 |
| 굿즈 재고 레코드 | 9,753 |
| 원본 보관 (raw_posts) | 68,586 |

## 데이터 모델 (9 테이블 · 2 축)

- **상영 축**: `movies` × `theaters` → `screenings`
- **특전 축**: `events` → `goodies` → `goods_stock`(× `theaters`)

| 테이블 | 행수 | 역할 | 주요 컬럼 |
|---|---:|---|---|
| `movies` | 645 | 영화 마스터 (제목 정규화 dedup 후 KOBIS·TMDB 백필) | title, kobis_code, tmdb_id, poster_url, release_date |
| `theaters` | 381 | 영화관 지점 (체인+독립), 좌표·주소 지오코딩 | chain, branch_name, sido, sigungu, latitude, longitude |
| `events` | 2,246 | 특전/이벤트 (카테고리 분류) | movie_id, event_name, start_date, end_date, category, image_url |
| `goodies` | 932 | 이벤트당 1~N 굿즈 | event_id, name, type, image_url |
| `goods_stock` | 9,753 | 굿즈×지점 재고 상태 | goodie_id, theater_id, status, remaining_qty, updated_at |
| `screenings` | 8,416 | 상영 회차 (영화×지점×날짜×시간×상영관) | movie_id, theater_id, play_date, start_time, format, booking_url |
| `raw_posts` | 68,586 | 크롤링 원본 보관 (재파싱용) | source, raw_json, image_urls, parse_status |
| `crawl_runs` | 740 | 배치 실행 기록 (분산 로컬 배치 가시화) | source, machine, status, events, detail |
| `batch_requests` | 2 | 어드민 수동 트리거 큐 | source, machine, requested_at |

## 분포

### 영화관 · 체인별 (381)
CGV 173 · MEGA 109 · LOTTE 88 · INDIE 11

### 영화관 · 지역별
미분류 **125** · 경기 116 · 서울 66 · 인천 20 · 부산 11 · 대구 9 · 그 외 34

### 특전 · 카테고리별 (2,246)
특전 939 · 상영회 733 · 영화 324 · 극장 93 · 미분류 79 · 제휴 71

### 상영 · 체인별 (8,416 · ~8일치 롤링)
CGV 3,783 · LOTTE 2,365 · MEGA 2,115 · INDIE 153

### 굿즈 · 타입별 (932)
포스터 510 · 기타 396 · TTT 16 · OT 10

### 굿즈 재고 · 상태별 (9,753)
보유 5,964 · 소진 3,226 · 소량보유 563

### 백필 완성도
- 포스터: 536 / 645 (83%)
- TMDB 매칭: 376 / 645 (58%)
- KOBIS 코드: 370 / 645 (57%)
- 지오코딩(theaters): 256 / 381 (67%)

## 리뉴얼 전에 알아둘 데이터 한계

1. **[Critical] 상영 커버리지가 좁다** — 상영 데이터 있는 지점 **48개**/381, 기간 **~8일치**(롤링). 수집이 기본 구역(일산·서울 서부 등)에 한정 → 전국·전 지점 시간표 UI는 데이터 없음.
2. **[Critical] 지오코딩 구멍** — **125개** 지점 sido 미분류(좌표 없음). "내 주변"·지도·지역 필터에서 빠짐.
3. **[Warning] 포스터 결측 17%** — 645편 중 109편 포스터 없음. 카드 UI에 placeholder 필수.
4. **[Warning] 독립영화관 데이터 얕음** — INDIE 상영 153회차, 인스타 수집 최근 이벤트 0건 연속. 독립관 중심 화면은 빈 상태 잦음.
5. **[Warning] 타입 계약이 mock에 묶임** — API 라우트는 라이브 Turso 조회하나 응답 타입을 `@mock/types`에서 재사용. 리뉴얼 시 실 스키마 기반 재정의 권장.

## 프론트가 붙일 API (Next.js route handlers · 라이브)

| 메서드 | 경로 | 용도 |
|---|---|---|
| GET | `/api/screenings` | 상영 시간표 (날짜·지점 필터) |
| GET | `/api/events` | 특전 피드 (카테고리 필터) |
| GET | `/api/movies/[id]` | 영화 상세 |
| GET | `/api/batch-runs` | 배치 실행 현황 |
| POST | `/api/admin/request-run` | 수동 배치 트리거 |
| POST | `/api/admin/dispatch` | 배치 디스패치 |

---

_출처: Turso 라이브 조회 · 스키마 `packages/shared/src/schema.ts` · 수집 `packages/crawler`. 상영·재고는 매일 갱신되어 수치는 조회 시점 기준._
