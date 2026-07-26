# cinemo

영화관별 특전(굿즈) 정보와 소진 현황을 한눈에 모아보는 캘린더 서비스

**🔗 서비스: https://mameil-cinemo.vercel.app**

## What

- CGV, 롯데시네마, 메가박스의 특전/굿즈 이벤트를 자동 수집
- 독립·예술영화관 인스타그램 피드에서 특전 공지를 자동 수집 (Apify + LLM 비전 파싱)
- 지점별 굿즈 소진 현황 실시간 연동
- 포스터 중심 UI로 일별/주간 캘린더 제공

## Tech Stack

| 항목 | 기술 |
|---|---|
| Frontend | Next.js, PWA |
| Backend | Serverless (Vercel) |
| DB | Turso (SQLite) |
| Crawler | TypeScript batch (GitHub Actions cron) |
| Storage | Cloudflare R2 |
| Language | TypeScript (monorepo) |

## ERD

```mermaid
erDiagram
    movies {
        int id PK
        text title
        text kobis_code
        int tmdb_id
        text poster_url
        text release_date
        text created_at
    }

    theaters {
        int id PK
        text chain "CGV / LOTTE / MEGA / INDIE"
        text branch_name
        text region
        text chain_branch_code
    }

    events {
        int id PK
        int movie_id FK
        text chain "CGV / LOTTE / MEGA / INDIE"
        text event_name
        text start_date
        text end_date
        text source_event_id
        text source_url
        text image_url
        text created_at
    }

    goodies {
        int id PK
        int event_id FK
        text name
        text type "포스터 / TTT / OT / 기타"
        text image_url
        text source_goods_id
    }

    goods_stock {
        int id PK
        int goodie_id FK
        int theater_id FK
        text status "보유 / 소량보유 / 소진"
        int remaining_qty "nullable, CGV만 제공"
        int total_qty "nullable, CGV만 제공"
        text updated_at
    }

    raw_posts {
        int id PK
        text source "CGV / LOTTE / MEGA / INSTA"
        text source_id
        text raw_json
        text image_urls
        text parse_status
        text parsed_at
        text created_at
    }

    movies ||--o{ events : "has"
    events ||--o{ goodies : "has"
    goodies ||--o{ goods_stock : "has"
    theaters ||--o{ goods_stock : "has"
```

## Architecture

```mermaid
graph TB
    subgraph GHA["⏰ GitHub Actions (크론)"]
        CG["crawl.yml<br/>3시간마다"]
        CS["schedule.yml<br/>매일 13시 KST"]
    end

    subgraph CRAWLER["📦 packages/crawler"]
        CC["특전/굿즈 수집<br/>CGV · 롯데 · 메가"]
        SC["상영시간표 수집<br/>CGV · 롯데 · 메가"]
        KB["KOBIS 백필"]
        TM["TMDB 포스터"]
    end

    subgraph DB["🗄️ Turso (SQLite)"]
        TB[(movies · theaters<br/>events · goodies<br/>goods_stock · screenings)]
    end

    subgraph WEB["🌐 apps/web — Vercel"]
        API["Route Handlers<br/>/api/screenings<br/>/api/movies/:id"]
        UI["React 화면<br/>홈(영화별·시간순)<br/>영화 상세"]
    end

    subgraph SHARED["📚 packages/shared"]
        DR["Drizzle 스키마<br/>DB 클라이언트"]
    end

    CG --> CC
    CS --> SC
    CC --> KB --> TM
    CC & SC --> |적재| TB
    TM --> |포스터 URL| TB

    TB --> |조회| API
    API --> UI
    DR -.- |타입·클라이언트 공유| CRAWLER
    DR -.- |타입·클라이언트 공유| API

    style GHA fill:#f0f4ff,stroke:#4a6cf7,stroke-width:2px
    style CRAWLER fill:#fff7ed,stroke:#ed6c00,stroke-width:2px
    style DB fill:#f0fdf4,stroke:#15803d,stroke-width:2px
    style WEB fill:#e2f1ef,stroke:#0f766e,stroke-width:2px
    style SHARED fill:#faf5ff,stroke:#6d2e9e,stroke-width:2px
```

## Project Structure

```
cinemo/
├── apps/web/            # Next.js — 캘린더 UI + 조회 API
├── packages/crawler/    # 크롤링 · 정제 · DB 적재
├── packages/shared/     # 공유 타입 · DB 스키마
├── docs/                # 설계서 · TODO
└── .github/workflows/   # GitHub Actions 크론
```
