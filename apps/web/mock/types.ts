/**
 * 프론트엔드 화면이 소비할 API 응답 타입 (목업 계약)
 *
 * 실제 DB 스키마(@cinemo/shared/schema.ts)를 화면 관점으로 조인·평탄화한 "읽기 모델".
 * 3개 화면(홈 시간표 / 영화 상세 / 지역 설정)에 각각 대응하는 3개 엔드포인트를 가정한다.
 *   - GET /api/screenings?region&date&chain  → HomeTimetable
 *   - GET /api/movies/:id                     → MovieDetail
 *   - GET /api/regions                        → RegionPreset[]
 */

export type Chain = "CGV" | "LOTTE" | "MEGA" | "INDIE";
export type StockStatus = "보유" | "소량보유" | "소진";
export type GoodieType = "포스터" | "TTT" | "OT" | "기타";

// ── 공통 미니 객체 ────────────────────────────────
export interface MovieMini {
  id: number;
  title: string;
  posterUrl: string | null; // null → 플레이스홀더 폴백
}

export interface TheaterMini {
  id: number;
  chain: Chain;
  branchName: string;
  region: string | null; // 서울 | 경기 | 인천 (체인 제공)
}

// ── 홈 (통합 시간표) ──────────────────────────────
/** 시간표 카드 1건 = 상영 회차 1개 (영화·지점·특전여부 조인) */
export interface ScreeningCard {
  id: number;
  movie: MovieMini;
  theater: TheaterMini;
  startTime: string; // HH:MM
  endTime: string | null;
  screenName: string | null;
  format: string | null; // 2D | IMAX LASER 2D | ULTRA 4DX 2D ...
  subtitleDub: string | null;
  remainingSeats: number | null;
  totalSeats: number | null;
  /** 이 영화에 진행중인 특전 이벤트가 있는가 (배지용) */
  hasEvent: boolean;
  /**
   * 이 상영 체인에서 이 영화로 받을 수 있는 특전 종류 (홈 카드 배지용).
   * 예: CGV 모아나 → ["TTT","포스터"]. 화면에선 앞 2개 + "+N"으로 축약.
   */
  eventTypes: GoodieType[];
  bookingUrl: string | null;
}

/**
 * v1은 지역 선택 UI 없이 크롤 대상 전역을 그대로 보여준다.
 * (파주·일산·고양·서울 서부 코리도) — 사용자 결정.
 */
export interface Coverage {
  label: string; // "파주 · 일산 · 고양 · 서울 서부"
  theaterCount: number;
}

/**
 * 특전 배지 클릭 시 보여줄 미리보기.
 * detailImages = 이벤트 상세 본문 이미지(굿즈 실물 도안 — OT 앞/뒷면, 포스터 도안 등)가 1순위,
 * 없으면 imageUrl(홍보 배너), 그것도 없으면 "이미지 미제공" 폴백.
 */
export interface EventPreview {
  type: GoodieType;
  eventName: string;
  /** 굿즈 실명 목록 ("리즈 포스터 2종" 등) — 화면 "뭘 받는지" 표기용 */
  goodieNames: string[];
  /** 원문 이벤트 페이지 (롯데·메가 제공, CGV는 웹 차단으로 없음) */
  sourceUrl?: string | null;
  /** 홍보 배너 (폴백용) */
  imageUrl: string | null;
  /** 실물 도안 이미지들 (상세 본문) */
  detailImages: string[];
  /** 진행 극장 id 목록 (재고 지점 기반). 빈 배열 = 지점 판별 불가 → 전 지점 취급 */
  theaterIds: number[];
  startDate: string;
  endDate: string;
}

export interface HomeTimetable {
  date: string; // YYYY-MM-DD
  coverage: Coverage;
  /** 데이터 신선도: 마지막 수집 시각 (화면에 "n시간 전" 표기) */
  updatedAt: string; // ISO
  /** 그날 크롤 전역에서 상영하는 영화 목록 — "영화 골라보기" 칩 소스 */
  movies: MovieMini[];
  /** 시간순 정렬된 상영 카드 */
  screenings: ScreeningCard[];
  /** `${movieId}-${chain}` → 진행 중 이벤트 미리보기 (특전 배지 클릭용). 목업엔 없음 */
  eventPreviews?: Record<string, EventPreview[]>;
  /** `${movieId}-${theaterId}` → 굿즈별 재고 (소진 제외) — 긴급도 표기용. 목업엔 없음 */
  goodieStock?: Record<string, GoodieStockLite[]>;
}

/** 지점별 굿즈 재고 요약 — "얼마나 급하게 봐야 하나" 판단용 */
export interface GoodieStockLite {
  type: GoodieType;
  name: string;
  eventName: string;
  /** CGV·롯데 제공, 메가 null */
  remaining: number | null;
  /** CGV만 제공 */
  total: number | null;
  status: string; // 보유 | 소량보유
}

// ── 영화 상세 ─────────────────────────────────────
export interface GoodieStock {
  theaterId: number;
  chain: Chain;
  branchName: string;
  region: string | null;
  status: StockStatus;
  remainingQty: number | null; // CGV만 제공
  totalQty: number | null; // CGV만 제공
  updatedAt: string; // ISO
}

export interface Goodie {
  id: number;
  name: string;
  type: GoodieType;
  imageUrl: string | null;
  stock: GoodieStock[];
}

export interface MovieEvent {
  id: number;
  chain: Chain;
  eventName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  sourceUrl: string | null;
  imageUrl: string | null;
  goodies: Goodie[];
}

/** 상세 화면의 상영 회차 (지점 정보 포함, 날짜별 그룹핑은 클라에서) */
export interface DetailScreening {
  id: number;
  theater: TheaterMini;
  playDate: string; // YYYY-MM-DD
  startTime: string;
  endTime: string | null;
  format: string | null;
  remainingSeats: number | null;
  totalSeats: number | null;
  bookingUrl: string | null;
}

export interface MovieDetail {
  id: number;
  title: string;
  posterUrl: string | null;
  releaseDate: string | null;
  events: MovieEvent[];
  /** 날짜별 상영 (key: YYYY-MM-DD) */
  screeningsByDate: Record<string, DetailScreening[]>;
}

// ── 지역 프리셋 ───────────────────────────────────
export interface RegionPreset {
  id: string;
  label: string; // "서울 도심(용산·강남)"
  /** 지점명 부분일치 키워드 (크롤러 --only 와 동일 개념) */
  keywords: string[];
  /** 이 프리셋에 매칭되는 지점 수 (참고용) */
  theaterCount: number;
}
