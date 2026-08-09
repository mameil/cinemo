import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ── 영화 ──────────────────────────────────────────
export const movies = sqliteTable(
  "movies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    kobisCode: text("kobis_code"),
    tmdbId: integer("tmdb_id"),
    posterUrl: text("poster_url"),
    /** KOBIS 영문 제목 — TMDB 한글 미등재 시 재검색용 (예: 일본 애니 총집편) */
    titleEn: text("title_en"),
    releaseDate: text("release_date"),
    /**
     * KOBIS/TMDB 매칭을 마지막으로 시도한 시각 (ISO).
     * 미매칭 영화를 매 실행 재검색하지 않기 위한 마커 — 백필은 이 값이
     * RECHECK_DAYS(7일)보다 오래됐거나 없는 것만 재시도한다 (2026-07-27 타임아웃 사고).
     */
    matchCheckedAt: text("match_checked_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    // 제목 기반 즉석 생성(findOrCreateMovie) 시 조회용
    index("movies_title_idx").on(t.title),
    // KOBIS/TMDB 백필 시 매칭·중복 확인용
    index("movies_kobis_code_idx").on(t.kobisCode),
  ]
);

// ── 영화관 (체인 지점 + 독립영화관) ─────────────────
export const theaters = sqliteTable(
  "theaters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chain: text("chain").notNull(), // CGV | LOTTE | MEGA | INDIE
    branchName: text("branch_name").notNull(),
    region: text("region"), // 체인 제공 시/도 (서울/경기/인천) — 코스
    chainBranchCode: text("chain_branch_code"), // 체인 내부 지점 코드
    // 지오코딩 결과 (좌표/주소 → 행정구역 자동 분류)
    latitude: text("latitude"),
    longitude: text("longitude"),
    sido: text("sido"), // 시/도 (예: 경기)
    sigungu: text("sigungu"), // 시/군/구 (예: 고양시 / 영등포구)
    address: text("address"), // 전체 주소 (지오코딩 원본)
  },
  (t) => [
    // 체인 내부 지점 코드 기준 upsert
    uniqueIndex("theaters_chain_branch_unq").on(t.chain, t.chainBranchCode),
  ]
);

// ── 특전 이벤트 ───────────────────────────────────
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    movieId: integer("movie_id").references(() => movies.id),
    chain: text("chain").notNull(), // CGV | LOTTE | MEGA | INDIE
    eventName: text("event_name").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    sourceEventId: text("source_event_id"), // 원본 시스템 이벤트 ID
    sourceUrl: text("source_url"),
    imageUrl: text("image_url"),
    /** 상세 본문 이미지 (JSON array) — 굿즈 실물 도안 (앞/뒷면 등). 배너와 달리 "진짜 특전 그림" */
    detailImageUrls: text("detail_image_urls"),
    /** 이벤트 분류 — 특전 | 영화 | 상영회 | 극장 | 제휴 | 기타 (이벤트 피드 필터용) */
    category: text("category"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    // 체인 + 원본 이벤트 ID 기준 upsert (재실행 중복 방지)
    uniqueIndex("events_chain_source_unq").on(t.chain, t.sourceEventId),
  ]
);

// ── 굿즈 (이벤트당 1~N개) ─────────────────────────
export const goodies = sqliteTable(
  "goodies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id),
    name: text("name").notNull(),
    type: text("type").notNull(), // 포스터 | TTT | OT | 기타
    imageUrl: text("image_url"),
    sourceGoodsId: text("source_goods_id"), // 원본 시스템 굿즈 ID
  },
  (t) => [
    // 이벤트 + 원본 굿즈 ID 기준 upsert
    uniqueIndex("goodies_event_source_unq").on(t.eventId, t.sourceGoodsId),
  ]
);

// ── 굿즈 소진 현황 (굿즈 × 지점) ──────────────────
export const goodsStock = sqliteTable(
  "goods_stock",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    goodieId: integer("goodie_id")
      .notNull()
      .references(() => goodies.id),
    theaterId: integer("theater_id")
      .notNull()
      .references(() => theaters.id),
    status: text("status").notNull(), // 보유 | 소량보유 | 소진
    remainingQty: integer("remaining_qty"), // CGV만 제공
    totalQty: integer("total_qty"), // CGV만 제공
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => [
    // 굿즈 × 지점 조합 기준 upsert (소진 상태 갱신)
    uniqueIndex("goods_stock_goodie_theater_unq").on(
      t.goodieId,
      t.theaterId
    ),
  ]
);

// ── 크롤링 원본 보관 ──────────────────────────────
export const rawPosts = sqliteTable("raw_posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(), // CGV | LOTTE | MEGA | INSTA
  sourceId: text("source_id"),
  rawJson: text("raw_json"),
  imageUrls: text("image_urls"), // JSON array
  parseStatus: text("parse_status").default("pending"), // pending | parsed | failed
  parsedAt: text("parsed_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ── 상영 (영화 × 지점 × 날짜 × 시간 × 상영관) ──────
export const screenings = sqliteTable(
  "screenings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    movieId: integer("movie_id").references(() => movies.id),
    theaterId: integer("theater_id")
      .notNull()
      .references(() => theaters.id),
    chain: text("chain").notNull(), // CGV | LOTTE | MEGA
    playDate: text("play_date").notNull(), // YYYY-MM-DD
    startTime: text("start_time").notNull(), // HH:MM
    endTime: text("end_time"), // HH:MM (nullable)
    screenName: text("screen_name"), // 상영관 (예: "6관")
    format: text("format"), // 2D | IMAX | 4DX | SX ...
    subtitleDub: text("subtitle_dub"), // 자막 | 더빙
    sourceMovieCode: text("source_movie_code"), // 체인 내부 영화 코드
    remainingSeats: integer("remaining_seats"), // 수집 시점 잔여좌석 (nullable)
    totalSeats: integer("total_seats"), // 총 좌석 (nullable)
    bookingUrl: text("booking_url"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at"), // 마지막 갱신(수집) 시각 — upsert마다 갱신
  },
  (t) => [
    // 회차 upsert 자연키
    uniqueIndex("screenings_unq").on(
      t.chain,
      t.theaterId,
      t.playDate,
      t.startTime,
      t.screenName,
      t.sourceMovieCode
    ),
    // 조회: 날짜+지점 / 영화별
    index("screenings_date_theater_idx").on(t.playDate, t.theaterId),
    index("screenings_movie_idx").on(t.movieId),
  ]
);

// ── 배치 실행 기록 ────────────────────────────────
// 로컬 인스타 배치(두 PC)는 로그가 각 기계에만 남아 중앙에서 실행 여부·결과를 알 수 없었다.
// 매 실행이 여기 한 줄 남겨 어디서든(Turso 조회/웹앱) 가시화한다. (2026-08-08)
export const crawlRuns = sqliteTable(
  "crawl_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(), // insta-local | insta-apify | (향후 확장)
    machine: text("machine").notNull(), // os.hostname() — 회사맥/회사데탑 구분
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    status: text("status").notNull(), // success | error
    events: integer("events"), // 적재(upsert)된 이벤트 수
    screenings: integer("screenings"), // 적재된 상영 회차 수
    detail: text("detail"), // 사람이 읽는 요약 또는 에러 메시지
  },
  (t) => [index("crawl_runs_started_idx").on(t.startedAt)]
);

// ── 배치 실행 요청 (어드민 수동 트리거) ───────────
// 어드민 버튼이 여기 한 줄 남기면, 각 기계의 폴러가 "내 마지막 실행보다 새 요청이면 수집"한다.
// (append-only. 기계별 self-serve라 done 플래그 불필요 — crawl_runs의 마지막 실행 시각과 비교.)
export const batchRequests = sqliteTable("batch_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(), // insta-local | goods | showtime
  requestedAt: text("requested_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
