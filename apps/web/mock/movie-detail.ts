import type { MovieDetail } from "./types";

/**
 * 영화 상세 목업 (GET /api/movies/9) — 모아나
 *
 * events(특전) = 체인별 이벤트 → goodies → 지점별 소진현황(goods_stock) 3단계 조인.
 * CGV는 잔여/총수량(remaining/total) 제공, 롯데/메가는 상태(보유/소량보유/소진)만 제공.
 * screeningsByDate = 날짜 전환 UI용 (오늘/내일).
 */
export const MOCK_MOVIE_DETAIL: MovieDetail = {
  id: 9,
  title: "모아나",
  posterUrl: "https://image.tmdb.org/t/p/w500/etJXeoQovaAcQD8gG0vebtoIlMH.jpg",
  releaseDate: "2026-07-08",

  events: [
    {
      id: 21,
      chain: "CGV",
      eventName: "[모아나] TTT",
      startDate: "2026-07-08",
      endDate: "2026-08-04",
      sourceUrl: "https://www.cgv.co.kr/culture-event/event/",
      imageUrl: null,
      goodies: [
        {
          id: 501,
          name: "모아나 TTT (To The Theater 티켓)",
          type: "TTT",
          imageUrl: null,
          stock: [
            { theaterId: 210, chain: "CGV", branchName: "CGV 일산", region: "경기", status: "소량보유", remainingQty: 42, totalQty: 500, updatedAt: "2026-07-12T06:10:00+09:00" },
            { theaterId: 211, chain: "CGV", branchName: "CGV 고양백석", region: "경기", status: "보유", remainingQty: 180, totalQty: 300, updatedAt: "2026-07-12T06:10:00+09:00" },
            { theaterId: 212, chain: "CGV", branchName: "CGV 파주운정", region: "경기", status: "소진", remainingQty: 0, totalQty: 200, updatedAt: "2026-07-12T06:10:00+09:00" },
          ],
        },
      ],
    },
    {
      id: 20,
      chain: "CGV",
      eventName: "[모아나] SX 포스터",
      startDate: "2026-07-10",
      endDate: "2026-08-06",
      sourceUrl: "https://www.cgv.co.kr/culture-event/event/",
      imageUrl: null,
      goodies: [
        {
          id: 502,
          name: "모아나 ScreenX 스페셜 포스터",
          type: "포스터",
          imageUrl: null,
          stock: [
            { theaterId: 210, chain: "CGV", branchName: "CGV 일산", region: "경기", status: "보유", remainingQty: 260, totalQty: 400, updatedAt: "2026-07-12T06:10:00+09:00" },
            { theaterId: 211, chain: "CGV", branchName: "CGV 고양백석", region: "경기", status: "보유", remainingQty: 155, totalQty: 300, updatedAt: "2026-07-12T06:10:00+09:00" },
          ],
        },
      ],
    },
    {
      id: 62,
      chain: "LOTTE",
      eventName: "<모아나> 1주차 현장 증정 이벤트",
      startDate: "2026-07-08",
      endDate: "2026-07-14",
      sourceUrl: "https://www.lottecinema.co.kr/NLCHS/Event/",
      imageUrl: null,
      goodies: [
        {
          id: 503,
          name: "모아나 오리지널 티켓 (OT)",
          type: "OT",
          imageUrl: null,
          stock: [
            // 롯데는 수량 미제공 → status만 (게이지는 status→근사 채움)
            { theaterId: 220, chain: "LOTTE", branchName: "파주운정", region: "경기", status: "보유", remainingQty: null, totalQty: null, updatedAt: "2026-07-12T05:40:00+09:00" },
            { theaterId: 221, chain: "LOTTE", branchName: "영등포", region: "서울", status: "소량보유", remainingQty: null, totalQty: null, updatedAt: "2026-07-12T05:40:00+09:00" },
            { theaterId: 222, chain: "LOTTE", branchName: "파주야당", region: "경기", status: "소진", remainingQty: null, totalQty: null, updatedAt: "2026-07-12T05:40:00+09:00" },
          ],
        },
      ],
    },
    {
      // ⚠️ 메가박스 지점별 소진현황 — 크롤러 추가 작업 예정(요청 예정)분을 선반영.
      // 메가도 롯데처럼 수량 미제공(status만) 가정 → 게이지는 status→근사 채움.
      id: 105,
      chain: "MEGA",
      eventName: "[모아나] 선착순 오리지널 티켓 증정",
      startDate: "2026-07-08",
      endDate: "2026-07-16",
      sourceUrl: "https://www.megabox.co.kr/event/detail",
      imageUrl: null,
      goodies: [
        {
          id: 504,
          name: "모아나 오리지널 티켓 (OT)",
          type: "OT",
          imageUrl: null,
          stock: [
            { theaterId: 161, chain: "MEGA", branchName: "고양스타필드", region: "경기", status: "보유", remainingQty: null, totalQty: null, updatedAt: "2026-07-12T05:55:00+09:00" },
            { theaterId: 162, chain: "MEGA", branchName: "목동", region: "서울", status: "소량보유", remainingQty: null, totalQty: null, updatedAt: "2026-07-12T05:55:00+09:00" },
            { theaterId: 163, chain: "MEGA", branchName: "파주금촌", region: "경기", status: "소진", remainingQty: null, totalQty: null, updatedAt: "2026-07-12T05:55:00+09:00" },
          ],
        },
      ],
    },
  ],

  screeningsByDate: {
    "2026-07-12": [
      { id: 1001, theater: { id: 210, chain: "CGV", branchName: "CGV 일산", region: "경기" }, playDate: "2026-07-12", startTime: "07:30", endTime: "09:35", format: "IMAX LASER 2D", remainingSeats: 536, totalSeats: 624, bookingUrl: "https://www.cgv.co.kr/ticket/" },
      { id: 1004, theater: { id: 161, chain: "MEGA", branchName: "고양스타필드", region: "경기" }, playDate: "2026-07-12", startTime: "08:20", endTime: "10:25", format: "2D", remainingSeats: 59, totalSeats: 144, bookingUrl: "https://www.megabox.co.kr/booking" },
      { id: 1008, theater: { id: 220, chain: "LOTTE", branchName: "파주운정", region: "경기" }, playDate: "2026-07-12", startTime: "10:20", endTime: "12:25", format: "SUPER PLEX", remainingSeats: 320, totalSeats: 420, bookingUrl: "https://www.lottecinema.co.kr/NLCHS/" },
      { id: 1011, theater: { id: 210, chain: "CGV", branchName: "CGV 일산", region: "경기" }, playDate: "2026-07-12", startTime: "19:20", endTime: "21:25", format: "IMAX LASER 2D", remainingSeats: 44, totalSeats: 624, bookingUrl: "https://www.cgv.co.kr/ticket/" },
    ],
    "2026-07-13": [
      { id: 2001, theater: { id: 210, chain: "CGV", branchName: "CGV 일산", region: "경기" }, playDate: "2026-07-13", startTime: "10:15", endTime: "12:20", format: "IMAX LASER 2D", remainingSeats: 600, totalSeats: 624, bookingUrl: "https://www.cgv.co.kr/ticket/" },
      { id: 2002, theater: { id: 161, chain: "MEGA", branchName: "고양스타필드", region: "경기" }, playDate: "2026-07-13", startTime: "13:40", endTime: "15:45", format: "2D", remainingSeats: 250, totalSeats: 300, bookingUrl: "https://www.megabox.co.kr/booking" },
    ],
  },
};
