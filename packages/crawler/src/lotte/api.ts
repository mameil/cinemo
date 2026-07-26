/**
 * 롯데시네마 API 클라이언트
 *
 * 엔드포인트 정리:
 * - 극장 목록: /LCWS/Cinema/CinemaData.aspx (GetCinemaItems)
 * - 상영일: /LCWS/Ticketing/TicketingData.aspx (GetMoviePlayDates)
 * - 이벤트 목록: /LCWS/Event/EventData.aspx (GetEventLists)
 * - 이벤트 상세: /LCWS/Event/EventData.aspx (GetEventDetail)
 *
 * 이벤트 분류 코드:
 * - 10: 리미티드 (HOT)
 * - 20: 굿즈 (영화 특전)
 * - 30: 우리동네영화관
 * - 40: 시사회/무대인사
 * - 50: 제휴할인
 *
 * 주의: Event API는 multipart/form-data로 전송해야 함
 */

const BASE_URL = "https://www.lottecinema.co.kr/LCWS";

// ── 타입 ────────────────────────────────────────

export interface LotteCinema {
  DivisionCode: number;
  DetailDivisionCode: string;
  CinemaID: number;
  CinemaNameKR: string;
  CinemaNameUS: string;
  CinemaName: string;
  SortSequence: number;
  Latitude: string;
  Longitude: string;
  CinemaAddrSummary: string;
  SmartOrderYN: string;
  StageGreetingYN: string;
}

export interface LottePlayDate {
  PlayDate: string;
  IsPlayDate: string;
  Year: number;
  Month: number;
  Day: number;
  DayOfWeekKR: string;
  DayOfWeekEN: string;
  HolidayYN: string;
}

export interface LotteEvent {
  EventID: string;
  EventName: string;
  EventClassificationCode: string;
  EventTypeCode?: string;
  EventTypeName?: string;
  ImageUrl: string;
  ProgressStartDate: string;
  ProgressEndDate: string;
  RemainsDayCount: number;
  RecYN: string;
  CinemaName?: string;
  CinemaAreaCode?: string;
  EventCntnt?: string;
  EventNtc?: string;
}

export interface LotteEventDetail {
  EventID: string;
  EventName: string;
  EventClassificationCode: string;
  EventTypeCd: string;
  EventCntnt: string;
  EventNtc: string;
  ProgressStartDate: string;
  ProgressEndDate: string;
  ImageUrl: string;
  MovieName?: string;
  MovieCode?: string;
}

// ── API 호출 (기본: URL-encoded) ────────────────

interface ApiResponse<T> {
  IsOK: string;
  ResultMessage?: string;
  [key: string]: T | string | undefined;
}

/**
 * fetch 재시도 래퍼 — 메가(curl --retry)·CGV(curl-impersonate 재시도)와 달리
 * 롯데는 fetch 직행이라 일시적 네트워크/타임아웃에 그대로 죽었음 (크론 간헐 실패 원인).
 * 네트워크 오류·5xx·JSON 파싱 실패를 재시도 대상으로 본다.
 */
async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit,
  attempts = 3
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
      if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 1000 * i)); // 1s, 2s
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function postApi<T>(
  endpoint: string,
  params: Record<string, unknown>
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const paramList = JSON.stringify({
    channelType: "HO",
    osType: "W",
    osVersion: "Mozilla/5.0",
    multiLanguageID: "KR",
    ...params,
  });

  const data = await fetchJsonWithRetry<ApiResponse<T>>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    body: `paramList=${encodeURIComponent(paramList)}`,
  });

  if (data.IsOK !== "true" && !data.Items && !data.Cinemas) {
    throw new Error(`Lotte API Error: ${data.ResultMessage || "Unknown error"}`);
  }

  return data as unknown as T;
}

// ── API 호출 (Event: multipart/form-data) ──────

async function postEventApi<T>(
  params: Record<string, unknown>
): Promise<T> {
  const url = `${BASE_URL}/Event/EventData.aspx`;
  const paramList = JSON.stringify({
    channelType: "HO",
    osType: "W",
    osVersion: "Mozilla/5.0",
    ...params,
  });

  // multipart/form-data 생성
  const boundary = "----WebKitFormBoundary" + Math.random().toString(36).slice(2);
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="paramList"',
    "",
    paramList,
    `--${boundary}--`,
  ].join("\r\n");

  return fetchJsonWithRetry<T>(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Referer: "https://www.lottecinema.co.kr/NLCHS/Event",
      Accept: "application/json",
    },
    body,
  });
}

// ── 극장/상영일 API ────────────────────────────

/** 극장 목록 조회 */
export async function fetchCinemaList(): Promise<LotteCinema[]> {
  const data = await postApi<{ Cinemas: { Items: LotteCinema[] } }>(
    "/Cinema/CinemaData.aspx",
    { MethodName: "GetCinemaItems" }
  );
  return data.Cinemas.Items;
}

/** 상영일 목록 조회 */
export async function fetchPlayDates(): Promise<LottePlayDate[]> {
  const data = await postApi<{ Items: { Items: LottePlayDate[] } }>(
    "/Ticketing/TicketingData.aspx",
    { MethodName: "GetMoviePlayDates" }
  );
  return data.Items.Items;
}

/** 상영 회차(시간표) 항목 */
export interface LottePlaySeq {
  CinemaID: number;
  MovieCode: string;
  RepresentationMovieCode: string;
  MovieNameKR: string;
  PlayDt: string; // YYYY-MM-DD
  StartTime: string; // HH:MM
  EndTime: string; // HH:MM
  ScreenNameKR: string; // 상영관
  FilmNameKR: string; // 2D | IMAX | ...
  TranslationDivisionNameKR: string; // 자막 | 더빙
  BookingSeatCount: number; // 예매 가능(잔여) 좌석
  TotalSeatCount: number;
}

/**
 * 지정 지점·날짜의 상영 회차 조회.
 * @param divisionCode 지점 DivisionCode
 * @param cinemaId 지점 CinemaID
 * @param playDate YYYY-MM-DD
 */
export async function fetchPlaySequence(
  divisionCode: number,
  cinemaId: number,
  playDate: string
): Promise<LottePlaySeq[]> {
  const data = await postApi<{ PlaySeqs?: { Items: LottePlaySeq[] } }>(
    "/Ticketing/TicketingData.aspx",
    {
      MethodName: "GetPlaySequence",
      playDate,
      cinemaID: `1|${divisionCode}|${cinemaId}`,
      representationMovieCode: "",
    }
  );
  return data.PlaySeqs?.Items ?? [];
}

// ── 이벤트 API ─────────────────────────────────

/** 이벤트 목록 조회 (분류 코드별) */
export async function fetchEventList(
  categoryCode: string = "0", // 0: 전체
  pageNo: number = 1,
  pageSize: number = 50
): Promise<{ Items: LotteEvent[]; TotalCount: number }> {
  const data = await postEventApi<{
    Items: LotteEvent[];
    TotalCount: number;
    IsOK: string;
  }>({
    MethodName: "GetEventLists",
    EventClassificationCode: categoryCode === "0" ? 0 : parseInt(categoryCode),
    SearchText: "",
    CinemaID: "",
    PageNo: pageNo,
    PageSize: pageSize,
    MemberNo: "0",
    sortDivCd: "1",
  });

  return {
    Items: data.Items || [],
    TotalCount: data.TotalCount || 0,
  };
}

/** 굿즈 이벤트 목록 (카테고리 20) */
export async function fetchGoodsEvents(): Promise<LotteEvent[]> {
  const data = await fetchEventList("20");
  return data.Items;
}

/** 시사회/무대인사 이벤트 목록 (카테고리 40) */
export async function fetchStageGreetingEvents(): Promise<LotteEvent[]> {
  const data = await fetchEventList("40");
  return data.Items;
}

/** 이벤트 상세 조회 */
export async function fetchEventDetail(
  eventId: string,
  eventTypeCode: string = "111"
): Promise<LotteEventDetail | null> {
  const data = await postEventApi<{
    InfomationDeliveryEventDetail?: LotteEventDetail[];
    ReservationEventDetail?: LotteEventDetail[];
    PurchaseEventDetail?: LotteEventDetail[];
    CommentEventDetail?: LotteEventDetail[];
    StageGreetingEventDetail?: LotteEventDetail[];
    PreviewEventDetail?: LotteEventDetail[];
    IsOK: string;
  }>({
    MethodName: "GetInfomationDeliveryEventDetail",
    EventID: eventId,
    EventTypeCode: eventTypeCode,
    MemberNo: "0",
  });

  // 여러 타입 중 하나에서 데이터 추출
  const detailKeys = [
    "InfomationDeliveryEventDetail",
    "ReservationEventDetail",
    "PurchaseEventDetail",
    "CommentEventDetail",
    "StageGreetingEventDetail",
    "PreviewEventDetail",
  ] as const;

  for (const key of detailKeys) {
    const details = data[key];
    if (details && Array.isArray(details) && details.length > 0) {
      const item = details[0] as unknown as Record<string, unknown>;
      return {
        EventID: (item.EventID as string) || eventId,
        EventName: (item.EventName as string) || "",
        EventClassificationCode: (item.EventClassificationCode as string) || "",
        EventTypeCd: (item.EventTypeCode as string) || "",
        EventCntnt: (item.EventContents as string) || "",
        EventNtc: (item.EventNotice as string) || "",
        ProgressStartDate: (item.ProgressStartDate as string) || "",
        ProgressEndDate: (item.ProgressEndDate as string) || "",
        ImageUrl: (item.ImgUrl as string) || (item.ListImgUrl as string) || "",
        MovieName: item.MovieName as string | undefined,
        MovieCode: item.MovieCode as string | undefined,
      };
    }
  }

  return null;
}

// ── 굿즈 재고 API ─────────────────────────────

/** 이벤트 상세에서 굿즈(GoodsGiftItems) 목록 추출 */
export interface LotteGoodsGiftItem {
  EventID: string;
  FrGiftID: string;
  FrGiftNm: string;
}

export async function fetchGoodsGiftItems(
  eventId: string
): Promise<LotteGoodsGiftItem[]> {
  const data = await postEventApi<{
    InfomationDeliveryEventDetail?: Array<{
      GoodsGiftItems?: LotteGoodsGiftItem[];
      GoodsShowYN?: string;
      [key: string]: unknown;
    }>;
    IsOK: string;
  }>({
    MethodName: "GetInfomationDeliveryEventDetail",
    EventID: eventId,
    EventTypeCode: "111",
    MemberNo: "0",
  });

  const detail = data.InfomationDeliveryEventDetail?.[0];
  return detail?.GoodsGiftItems ?? [];
}

/** 지점별 굿즈 재고 (Cnt = 잔여 수량) */
export interface LotteCinemaGoods {
  DivisionCode: number;
  DetailDivisionCode: string;
  CinemaID: string;
  CinemaNameKR: string;
  CinemaNameUS: string;
  SortSequence: number;
  Cnt: number;
  DetailDivisionNameKR: string;
  DetailDivisionNameUS: string;
}

export async function fetchCinemaGoods(
  eventId: string,
  giftId: string
): Promise<LotteCinemaGoods[]> {
  const data = await postEventApi<{
    CinemaDivisionGoods?: LotteCinemaGoods[];
    IsOK: string;
  }>({
    MethodName: "GetCinemaGoods",
    EventID: eventId,
    GiftID: giftId,
  });

  return data.CinemaDivisionGoods ?? [];
}

// ── 유틸리티 ───────────────────────────────────

/** 이미지 URL 구성 (CDN) */
export function buildImageUrl(imagePath: string): string {
  if (!imagePath) return "";
  if (imagePath.startsWith("http")) return imagePath;
  return `https://cf.lottecinema.co.kr${imagePath}`;
}

/** 이벤트 분류 코드 -> 이름 */
export function getEventCategoryName(code: string): string {
  const categories: Record<string, string> = {
    "10": "리미티드",
    "20": "굿즈",
    "30": "우리동네영화관",
    "40": "시사회/무대인사",
    "50": "제휴할인",
  };
  return categories[code] || "기타";
}
