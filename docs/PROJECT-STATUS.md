# cinemo 프로젝트 현황

영화관별 **상영시간표 + 특전(굿즈)** 을 지역·날짜로 모아보는 서비스. 크롤러가 데이터를 수집·정규화해
Turso DB에 적재하고, GitHub Actions 크론이 자동 갱신한다.

> 상세 작업 로그: [`ingest-tasks.md`](./ingest-tasks.md) (특전 적재) · [`showtime-tasks.md`](./showtime-tasks.md) (상영시간표) · [`github-actions-crawl.md`](./github-actions-crawl.md) (자동화)

---

## 진행 현황

| 영역 | 상태 |
|---|---|
| **Phase 1 — 기반** (모노레포, Drizzle 스키마, Turso) | ✅ 완료 |
| **Phase 2 — 특전/굿즈 크롤러** (CGV·롯데·메가·KOBIS·TMDB) | ✅ 완료 |
| **적재 파이프라인** (정규화 → upsert, 영화 매칭·dedup) | ✅ 완료 |
| **상영시간표 크롤러** (CGV·롯데·메가 3사) | ✅ 완료 |
| **자동화** (GitHub Actions 크론 2개 + 실패 알림) | ✅ 완료 |
| **Phase 3 — 웹** (Next.js 조회 API + UI + 배포) | ✅ 완료 — **https://mameil-cinemo.vercel.app** |
| **Phase 4 — 독립영화관/인스타, 알림 등** | ⬜ 미착수 |

---

## 아키텍처

```
cinemo/ (pnpm 모노레포)
├── packages/shared/   DB 스키마(Drizzle) · db 클라이언트 · TMDB
├── packages/crawler/  크롤러 · 정규화 · 적재
│   ├── domain.ts              공통 정규화 타입 (CollectedEvent / CollectedScreening ...)
│   ├── db/repo.ts             upsert + ingest / ingestScreenings (영화·지점 매칭)
│   ├── db/movie-match.ts      제목 정규화 + findOrCreateMovie
│   ├── {cgv,lotte,megabox}/   각 체인 api.ts + collect.ts(특전) + schedule.ts(상영)
│   ├── kobis/ , kobis-backfill.ts , tmdb-sync.ts
│   ├── index.ts               굿즈 크롤 오케스트레이터 (pnpm crawl)
│   └── schedule-all.ts        상영 크롤 오케스트레이터 (pnpm crawl:schedule)
└── apps/web/          Next.js 웹 (홈 시간표 + 영화 상세 + 특전 미리보기)
                       → 배포: https://mameil-cinemo.vercel.app (master push 자동 배포)
```

## 데이터 모델 (Turso / SQLite)

`movies` · `theaters` · `events`(특전) · `goodies`(굿즈) · `goods_stock`(소진현황)
· `screenings`(상영 회차) · `raw_posts`(원본 아카이브)

핵심 연결: **movies ← events ← goodies ← goods_stock(×theaters)** 와
**movies ← screenings(×theaters)**. 영화는 이름 정규화로 교차 체인 dedup, KOBIS/TMDB 백필.

---

## 실행 명령

```bash
pnpm crawl              # 특전/굿즈 전체: CGV·롯데·메가 → KOBIS 백필 → TMDB 포스터
pnpm crawl:schedule     # 상영시간표: 롯데·메가·CGV (기본 구역 = 일산/서울 서부)
pnpm crawl:schedule -- --all   # 상영 수도권 전체 (무거움 · 무료 예산 주의)
```
개별: `pnpm --filter @cinemo/crawler <cgv|lotte|megabox|kobis-backfill|tmdb|lotte-schedule|megabox-schedule|cgv-schedule>`

## 자동화 (GitHub Actions 크론 2개)

| 워크플로우 | 주기(KST) | 내용 |
|---|---|---|
| `crawl.yml` | 3시간마다 | 특전/굿즈/소진현황 (자주 변함) |
| `schedule.yml` | 매일 13시 | 상영시간표 (1주일 앞까지만 열림) |

- 실패 시 exit 1 → GitHub 기본 알림(모바일/이메일) + Job Summary 표
- Secrets(Turso/KOBIS/TMDB)는 레포에 등록됨 · CGV는 curl-impersonate로 Cloudflare 우회

---

## 현재 데이터 커버리지

- **특전/영화/포스터**: 전국(전체) — 이벤트 ~100건, 영화 dedup + KOBIS/TMDB 연결
- **상영시간표**: 롯데 수도권 전체 + CGV·메가는 **데모용 구역(일산/서울서부)만** 적재됨
  (수도권 전체 매일은 무료 예산 초과 → 크론 기본은 구역)
- 크롤 시점 스냅샷 — 크론이 돌면 자동 갱신

## 알려진 한계 / TODO

- **롯데 굿즈 개별·소진현황 없음** — 롯데 API 미제공 (이벤트+영화연결까지만)
- **굿즈 개별 이미지 없음** — 이벤트 배너만 (상세 HTML 파싱 필요, 보류)
- **굿즈명이 영화로 오추출**되는 소수 케이스 (예: "키링") — 정리 필요
- **레포 public 전환** — Actions 무제한용. 사전: 키 재발급 + 히스토리 세탁 (현재 private)
- **매 실행 결과 알림(성공 포함·데이터레벨)** — webhook 필요, 희망사항으로 보류
- 상영시간표 수도권 전체 완주 — 예산 고려해 선택적

## 다음 단계 (권장)

Phase 3 완료 (2026-07-19 Vercel 배포). 남은 후보:
- 상영 커버리지 확대 (CGV·메가 수도권 전체 — 예산 고려)
- 레포 public 전환 (키 재발급 + 히스토리 세탁 선행)
- Phase 4: 독립영화관/인스타 수집, 관심영화 알림
- v2 UI: 지역 프리셋 · 특전 모아보기 · 캘린더 뷰 · PWA
