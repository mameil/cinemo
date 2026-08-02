/**
 * 크롤러 공통 정규화 타입
 *
 * 각 체인 크롤러는 원본 응답을 아래 `CollectedEvent[]` 형태로 매핑(collect)하고,
 * 적재는 공용 `ingest()`(db/repo.ts)가 담당한다.
 * → 체인 추가 시 매핑 함수만 작성하면 됨.
 */

export type Chain = "CGV" | "LOTTE" | "MEGA" | "INDIE";

/** 굿즈 소진 상태 (메가박스 기준 3단계, CGV는 수량으로 환산) */
export type StockStatus = "보유" | "소량보유" | "소진";

/** 굿즈 종류 */
export type GoodieType = "포스터" | "TTT" | "OT" | "기타";

/** 지점별 소진 현황 (굿즈 × 지점) */
export interface CollectedStock {
  /** 체인 내부 지점 코드 */
  branchCode: string;
  branchName: string;
  region?: string;
  status: StockStatus;
  /** 잔여 수량 (CGV만 제공) */
  remainingQty?: number;
  /** 총 수량 (CGV만 제공) */
  totalQty?: number;
}

/** 굿즈 (이벤트당 1~N개) */
export interface CollectedGoodie {
  name: string;
  /** 미지정 시 이름으로 자동 분류 (classifyGoodieType) */
  type?: GoodieType;
  imageUrl?: string;
  /** 원본 시스템 굿즈 ID (없으면 name으로 대체되어 dedup) */
  sourceGoodsId?: string;
  stock: CollectedStock[];
}

/** 특전 이벤트 (정규화 단위) */
export interface CollectedEvent {
  chain: Chain;
  /** 원본 시스템 이벤트 ID (upsert 자연키) */
  sourceEventId: string;
  eventName: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  sourceUrl?: string;
  imageUrl?: string;
  /** 상세 본문 이미지 (굿즈 실물 도안, 앞/뒷면 등) — 배너와 다른 "진짜 특전 그림" */
  detailImageUrls?: string[];
  /** 이벤트 분류 — 특전 | 영화 | 상영회 | 극장 | 제휴 | 기타 */
  category?: string;
  /** 영화 매칭용 제목 (없으면 movieId=null) */
  movieTitle?: string;
  /** true면 기존 영화에만 연결 (새 영화 행 생성 금지) — 일반 이벤트용 */
  linkMovieOnly?: boolean;
  goodies: CollectedGoodie[];
  /** raw_posts 아카이빙용 원본 응답 */
  raw: unknown;
}

/** 상영 회차 (영화 × 지점 × 날짜 × 시간) */
export interface CollectedScreening {
  chain: Chain;
  // 지점 식별 (theaters upsert용)
  branchCode: string;
  branchName: string;
  region?: string;
  // 영화 (이름 매칭 + 체인 코드)
  movieTitle: string;
  sourceMovieCode?: string;
  // 회차
  playDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime?: string;
  screenName?: string; // 상영관
  format?: string; // 2D | IMAX | ...
  subtitleDub?: string; // 자막 | 더빙
  remainingSeats?: number;
  totalSeats?: number;
  bookingUrl?: string;
  /** 체인 시간표가 주는 썸네일 — TMDB 미등재 편성(콘서트 실황 등)의 포스터 폴백용 */
  posterUrl?: string;
}

/** 상영 적재 결과 통계 */
export interface ScreeningStats {
  screenings: number;
  theaters: number;
  moviesLinked: number;
  /** 재시도까지 실패해 건너뛴 행 수 */
  skipped: number;
}

/** ingest 결과 통계 */
export interface IngestStats {
  events: number;
  goodies: number;
  stock: number;
  theaters: number;
  moviesLinked: number;
  /** 재시도까지 실패해 건너뛴 이벤트 수 */
  skipped: number;
}
