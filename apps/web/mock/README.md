# apps/web/mock — 프론트엔드 목업 데이터 + 화면 시안

Next.js 앱 스캐폴딩 전, **화면 설계·디자인 논의용** 고정 데이터와 시안.
값은 실제 Turso DB(2026-07-12 스냅샷, 크롤 전역)에서 추출.

## 파일

| 파일 | 내용 |
|---|---|
| `types.ts` | API 응답 타입(읽기 모델) — 화면이 소비할 계약 |
| `regions.ts` | 지역 프리셋 (⚠️ v1 홈은 미사용 · v2 보류) |
| `home-timetable.ts` | 홈 시간표 목업 (`GET /api/screenings`) |
| `movie-detail.ts` | 영화 상세 목업 (`GET /api/movies/:id`) — 모아나 |
| `index.ts` | 진입점 (re-export) |
| `preview.html` | **화면 시안** — 브라우저로 바로 열기 (어시스턴트 홈/영화별/시간순/상세 4화면) |

## 시안 보는 법

```bash
open apps/web/mock/preview.html    # macOS
# 또는 브라우저로 파일 드래그
```

정적 HTML 1개라 빌드 불필요. (온라인 아카이브 링크는 `docs/frontend-tasks.md` 참고)

## 실제 API 붙일 때

`types.ts`의 타입을 그대로 쓰고, route handler가 이 형태로 조인·반환하면 된다.
매핑은 `docs/frontend-tasks.md`의 "API ↔ 데이터 매핑" 표 참고.
