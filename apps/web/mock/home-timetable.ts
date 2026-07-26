import type { HomeTimetable, MovieMini } from "./types";

/**
 * 홈 통합 시간표 목업 (GET /api/screenings?date=2026-07-12)
 *
 * v1은 지역 선택 없이 크롤 대상 전역(파주·일산·고양·서울 서부)을 시간순으로 보여준다.
 * 값은 실제 DB의 해당 코리도 지점 기반.
 * - seats: 잔여/총 그대로 노출 + 임박/매진만 색 강조
 * - eventTypes: 그 상영 체인에서 이 영화로 받을 수 있는 특전 종류 (없으면 hasEvent=false)
 * - 군체·하나 코리아: posterUrl=null (플레이스홀더 폴백)
 */
const MOVIES: Record<string, MovieMini> = {
  moana: { id: 9, title: "모아나", posterUrl: "https://image.tmdb.org/t/p/w500/etJXeoQovaAcQD8gG0vebtoIlMH.jpg" },
  nundongja: { id: 5, title: "눈동자", posterUrl: "https://image.tmdb.org/t/p/w500/jOD0Z78Jo0njtJu1hlC27LEs78F.jpg" },
  toy5: { id: 19, title: "토이 스토리 5", posterUrl: "https://image.tmdb.org/t/p/w500/AqrJx3nVVMlKWXGaPIH32GzjEJA.jpg" },
  martie: { id: 8, title: "마티 슈프림", posterUrl: "https://image.tmdb.org/t/p/w500/hqzCMHTuymM7FOZwpHfW5meiX1m.jpg" },
  gunche: { id: 39, title: "군체", posterUrl: null },
  hana: { id: 43, title: "하나 코리아", posterUrl: null },
};

// 크롤 코리도 지점 (실제 데이터 보유)
const ILSAN = { id: 210, chain: "CGV" as const, branchName: "CGV 일산", region: "경기" };
const GOYANG = { id: 211, chain: "CGV" as const, branchName: "CGV 고양백석", region: "경기" };
const PAJU_CGV = { id: 212, chain: "CGV" as const, branchName: "CGV 파주운정", region: "경기" };
const YDP_CGV = { id: 213, chain: "CGV" as const, branchName: "CGV 영등포타임스퀘어", region: "서울" };
const GOYANG_STAR = { id: 161, chain: "MEGA" as const, branchName: "고양스타필드", region: "경기" };
const MOKDONG = { id: 162, chain: "MEGA" as const, branchName: "목동", region: "서울" };
const PAJU_LOTTE = { id: 220, chain: "LOTTE" as const, branchName: "파주운정", region: "경기" };
const YDP_LOTTE = { id: 221, chain: "LOTTE" as const, branchName: "영등포", region: "서울" };

const CGV_URL = "https://www.cgv.co.kr/ticket/";
const LOTTE_URL = "https://www.lottecinema.co.kr/NLCHS/";
const MEGA_URL = "https://www.megabox.co.kr/booking";

export const MOCK_HOME_TIMETABLE: HomeTimetable = {
  date: "2026-07-12",
  coverage: { label: "파주 · 일산 · 고양 · 서울 서부", theaterCount: 21 },
  updatedAt: "2026-07-12T06:10:00+09:00",
  movies: [MOVIES.moana, MOVIES.nundongja, MOVIES.toy5, MOVIES.martie, MOVIES.gunche, MOVIES.hana],
  screenings: [
    {
      id: 1001, movie: MOVIES.moana, theater: ILSAN,
      startTime: "07:30", endTime: "09:35", screenName: "IMAX관", format: "IMAX LASER 2D",
      subtitleDub: "자막", remainingSeats: 536, totalSeats: 624,
      hasEvent: true, eventTypes: ["TTT", "포스터"], bookingUrl: CGV_URL,
    },
    {
      id: 1002, movie: MOVIES.nundongja, theater: ILSAN,
      startTime: "07:40", endTime: "09:35", screenName: "5관", format: "2D",
      subtitleDub: null, remainingSeats: 214, totalSeats: 214,
      hasEvent: true, eventTypes: ["기타"], bookingUrl: CGV_URL,
    },
    {
      id: 1003, movie: MOVIES.toy5, theater: GOYANG_STAR,
      startTime: "08:10", endTime: "10:02", screenName: "MX관", format: "MX 2D",
      subtitleDub: "더빙", remainingSeats: 180, totalSeats: 240,
      hasEvent: true, eventTypes: ["TTT"], bookingUrl: MEGA_URL,
    },
    {
      id: 1004, movie: MOVIES.moana, theater: GOYANG_STAR,
      startTime: "08:20", endTime: "10:25", screenName: "3관", format: "2D",
      subtitleDub: "더빙", remainingSeats: 59, totalSeats: 144,
      hasEvent: true, eventTypes: ["OT"], bookingUrl: MEGA_URL,
    },
    {
      id: 1005, movie: MOVIES.gunche, theater: PAJU_CGV,
      startTime: "08:15", endTime: "10:27", screenName: "4관", format: "2D",
      subtitleDub: null, remainingSeats: 10, totalSeats: 130,
      hasEvent: false, eventTypes: [], bookingUrl: CGV_URL,
    },
    {
      id: 1006, movie: MOVIES.martie, theater: YDP_CGV,
      startTime: "08:40", endTime: "11:20", screenName: "6관", format: "2D",
      subtitleDub: "자막", remainingSeats: 12, totalSeats: 200,
      hasEvent: true, eventTypes: ["포스터"], bookingUrl: CGV_URL,
    },
    {
      id: 1007, movie: MOVIES.moana, theater: PAJU_LOTTE,
      startTime: "10:20", endTime: "12:25", screenName: "수퍼플렉스", format: "SUPER PLEX",
      subtitleDub: "더빙", remainingSeats: 320, totalSeats: 420,
      hasEvent: true, eventTypes: ["OT"], bookingUrl: LOTTE_URL,
    },
    {
      id: 1008, movie: MOVIES.toy5, theater: MOKDONG,
      startTime: "11:30", endTime: "13:22", screenName: "1관", format: "2D",
      subtitleDub: "더빙", remainingSeats: 0, totalSeats: 210,
      hasEvent: true, eventTypes: ["TTT", "포스터", "OT"], bookingUrl: MEGA_URL,
    },
    {
      id: 1009, movie: MOVIES.hana, theater: GOYANG,
      startTime: "13:00", endTime: "14:55", screenName: "7관", format: "2D",
      subtitleDub: null, remainingSeats: 140, totalSeats: 150,
      hasEvent: false, eventTypes: [], bookingUrl: CGV_URL,
    },
    {
      id: 1010, movie: MOVIES.nundongja, theater: YDP_LOTTE,
      startTime: "14:40", endTime: "16:35", screenName: "2관", format: "2D",
      subtitleDub: null, remainingSeats: 3, totalSeats: 180,
      hasEvent: true, eventTypes: ["기타"], bookingUrl: LOTTE_URL,
    },
    {
      id: 1011, movie: MOVIES.moana, theater: ILSAN,
      startTime: "19:20", endTime: "21:25", screenName: "IMAX관", format: "IMAX LASER 2D",
      subtitleDub: "자막", remainingSeats: 44, totalSeats: 624,
      hasEvent: true, eventTypes: ["TTT", "포스터"], bookingUrl: CGV_URL,
    },
    {
      id: 1012, movie: MOVIES.martie, theater: GOYANG_STAR,
      startTime: "20:10", endTime: "22:50", screenName: "5관", format: "2D",
      subtitleDub: "자막", remainingSeats: 171, totalSeats: 200,
      hasEvent: true, eventTypes: ["기타"], bookingUrl: MEGA_URL,
    },
  ],
};
