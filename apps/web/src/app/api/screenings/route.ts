import { NextRequest, NextResponse } from "next/server";
import { db, INDIE_THEATERS } from "@cinemo/shared";
import { screenings, movies, theaters, events, goodies, goodsStock } from "@cinemo/shared";
import { eq, and, sql, or, like, not } from "drizzle-orm";
import type { HomeTimetable, ScreeningCard, MovieMini, GoodieType } from "@mock/types";
import { isObtainable, requiredFormat, formatSatisfies } from "@/lib/event-rules";
import { withDbRetry, SNAPSHOT_CACHE_HEADERS } from "@/lib/db-retry";

/** Turso 순간 단절 흡수 — 핸들러 전체 재시도 (읽기 전용이라 안전) */
export function GET(req: NextRequest) {
  return withDbRetry(() => handleGet(req));
}

// v1 기본 코리도: 일산·고양·파주(운정) + 서울 서부(영등포·목동·신촌·홍대)
const DEFAULT_KEYWORDS = [
  "일산", "화정", "행신", "운정", "금촌", "라페스타", "킨텍스",
  "영등포", "목동", "신촌", "홍대",
  "고양스타필드", "백석",
];

// 키워드에 걸리더라도 제외할 지점 (너무 먼 곳)
const EXCLUDE_KEYWORDS = [
  "위례", "문산", "부천", "월드컵경기장", "수원", "안성", "하남",
];

async function handleGet(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const today = todayKST();
  const date = searchParams.get("date") ?? today;
  const homeSummary = searchParams.get("view") === "home";

  // 지역 키워드 필터 (포함 + 제외)
  const includeFilter = or(
    ...DEFAULT_KEYWORDS.map((kw) => like(theaters.branchName, `%${kw}%`))
  );
  const excludeFilter = and(
    ...EXCLUDE_KEYWORDS.map((kw) => not(like(theaters.branchName, `%${kw}%`)))
  );
  // 독립영화관(INDIE)은 활성 계정만 수집되므로 코리도 키워드와 무관하게 노출
  const branchFilter = or(and(includeFilter, excludeFilter), eq(theaters.chain, "INDIE"));

  // 1) 해당 날짜의 상영 회차 + 영화 + 극장 조인 (코리도 필터 적용)
  const rows = await db
    .select({
      id: screenings.id,
      movieId: screenings.movieId,
      movieTitle: movies.title,
      posterUrl: movies.posterUrl,
      theaterId: screenings.theaterId,
      chain: screenings.chain,
      branchName: theaters.branchName,
      region: theaters.region,
      playDate: screenings.playDate,
      startTime: screenings.startTime,
      endTime: screenings.endTime,
      screenName: screenings.screenName,
      format: screenings.format,
      subtitleDub: screenings.subtitleDub,
      remainingSeats: screenings.remainingSeats,
      totalSeats: screenings.totalSeats,
      bookingUrl: screenings.bookingUrl,
      updatedAt: screenings.updatedAt,
    })
    .from(screenings)
    .leftJoin(movies, eq(screenings.movieId, movies.id))
    .innerJoin(theaters, eq(screenings.theaterId, theaters.id))
    .where(and(eq(screenings.playDate, date), branchFilter))
    .orderBy(screenings.startTime);

  // 2) 해당 날짜에 진행 중인 특전 — 지점별 재고까지 조인 (소진 포함 전체)
  //    배지용 타입 맵은 아래 루프에서 소진 제외, 진행 극장 판별은 소진 포함.
  const activeStockRows = await db
    .select({
      eventId: events.id,
      movieId: events.movieId,
      chain: events.chain,
      eventName: events.eventName,
      goodieType: goodies.type,
      goodieName: goodies.name,
      theaterId: goodsStock.theaterId,
      status: goodsStock.status,
      remainingQty: goodsStock.remainingQty,
      totalQty: goodsStock.totalQty,
      releaseDate: movies.releaseDate,
    })
    .from(events)
    .innerJoin(goodies, eq(goodies.eventId, events.id))
    .innerJoin(goodsStock, eq(goodsStock.goodieId, goodies.id))
    .leftJoin(movies, eq(events.movieId, movies.id))
    .where(
      and(
        sql`${events.startDate} <= ${date}`,
        sql`${events.endDate} >= ${date}`,
      )
    );

  // 영화+지점 → 특전 엔트리 {종류, 요구포맷} — 포맷 전용 특전(4DX 포스터 등)은
  // 해당 포맷 상영에만 배지가 붙도록 카드 변환 시 필터링한다 (노출 규칙 ④)
  type GoodieEntry = { type: string; fmt: string | null };
  const entriesByTheater = new Map<string, GoodieEntry[]>();
  // `${movieId}-${theaterId}` → 굿즈별 재고 (소진 제외)
  const goodieStock: Record<string, {
    type: string; name: string; eventName: string;
    remaining: number | null; total: number | null; status: string;
  }[]> = {};
  // 이벤트 → 진행 극장 (재고 지점 목록 = 이벤트 페이지의 "진행 극장").
  // 돌비관 전용 포스터 같은 이벤트가 다른 지점 미리보기에 섞이지 않도록 클라에서 필터링용.
  const eventTheaters = new Map<number, Set<number>>();
  const pushEntry = (map: Map<string, GoodieEntry[]>, key: string, en: GoodieEntry) => {
    const list = map.get(key) ?? [];
    if (!list.some((x) => x.type === en.type && x.fmt === en.fmt)) list.push(en);
    map.set(key, list);
  };
  for (const e of activeStockRows) {
    if (!e.movieId) continue;
    // 얼리버드류: 개봉 후엔 획득 불가 → 배지/진행극장에서 제외
    if (!isObtainable(e.eventName, e.releaseDate, date)) continue;
    // 진행 극장: 소진 포함 (이벤트 자체는 그 지점에서 진행 중)
    if (!eventTheaters.has(e.eventId)) eventTheaters.set(e.eventId, new Set());
    eventTheaters.get(e.eventId)!.add(e.theaterId);
    // 배지용 타입 맵: 소진 지점은 제외 (받을 수 없으므로)
    if (e.status === "소진") continue;
    pushEntry(entriesByTheater, `${e.movieId}-${e.theaterId}`, {
      type: e.goodieType,
      fmt: requiredFormat(e.eventName),
    });
    // 지점별 재고 맵 — "얼마나 급하게 봐야 하나" 판단용 (잔여/총 or 상태)
    const gsKey = `${e.movieId}-${e.theaterId}`;
    const gsList = goodieStock[gsKey] ?? (goodieStock[gsKey] = []);
    if (!gsList.some((x) => x.name === e.goodieName && x.eventName === e.eventName)) {
      gsList.push({
        type: e.goodieType,
        name: e.goodieName,
        eventName: e.eventName,
        remaining: e.remainingQty ?? null,
        total: e.totalQty ?? null,
        status: e.status,
      });
    }
  }

  // 재고 데이터가 없는 이벤트도 있으므로 (롯데 등), 체인 레벨 폴백 추가
  const activeEventsNoStock = await db
    .select({
      eventId: events.id,
      movieId: events.movieId,
      chain: events.chain,
      goodieType: goodies.type,
      goodieName: goodies.name,
      eventName: events.eventName,
      imageUrl: events.imageUrl,
      detailImageUrls: events.detailImageUrls,
      startDate: events.startDate,
      endDate: events.endDate,
      releaseDate: movies.releaseDate,
    })
    .from(events)
    .innerJoin(goodies, eq(goodies.eventId, events.id))
    .leftJoin(movies, eq(events.movieId, movies.id))
    .where(
      and(
        sql`${events.startDate} <= ${date}`,
        sql`${events.endDate} >= ${date}`,
      )
    );

  // 특전 배지 클릭용 미리보기 — `${movieId}-${chain}` → 이벤트 목록
  // detailImages(실물 도안)가 1순위, imageUrl(배너)은 폴백
  const eventPreviews: Record<string, {
    type: string; eventName: string; goodieNames: string[]; imageUrl: string | null;
    detailImages: string[]; theaterIds: number[]; startDate: string; endDate: string;
  }[]> = {};
  const previewByKey = new Map<string, { goodieNames: string[] }>(); // 이벤트×타입 → 엔트리 (굿즈명 누적)
  for (const e of activeEventsNoStock) {
    if (!e.movieId) continue;
    if (!isObtainable(e.eventName, e.releaseDate, date)) continue;
    const dedupKey = `${e.eventId}-${e.goodieType}`;
    const existing = previewByKey.get(dedupKey);
    if (existing) {
      // 같은 이벤트×타입의 다른 굿즈 → 이름만 누적
      if (e.goodieName && !existing.goodieNames.includes(e.goodieName)) {
        existing.goodieNames.push(e.goodieName);
      }
      continue;
    }
    const key = `${e.movieId}-${e.chain}`;
    let detailImages: string[] = [];
    try {
      detailImages = e.detailImageUrls ? JSON.parse(e.detailImageUrls) : [];
    } catch {}
    const entry = {
      type: e.goodieType,
      eventName: e.eventName,
      goodieNames: e.goodieName ? [e.goodieName] : [],
      imageUrl: e.imageUrl ?? null,
      detailImages,
      // 진행 극장 (빈 배열 = 재고 데이터 없는 이벤트 → 지점 판별 불가, 전 지점 표시)
      theaterIds: [...(eventTheaters.get(e.eventId) ?? [])],
      startDate: e.startDate,
      endDate: e.endDate,
    };
    previewByKey.set(dedupKey, entry);
    (eventPreviews[key] ??= []).push(entry);
  }

  // 재고 데이터가 전혀 없는 이벤트(지점 미확인)만 체인 전체 부가 타입으로.
  // 재고 데이터가 있는 이벤트는 지점 단위(entriesByTheater)로만 —
  // 진행 극장 밖 지점에 배지가 뜨고 모달은 비는 불일치 방지 (특전-노출-규칙.md ①).
  const unknownChainEntries = new Map<string, GoodieEntry[]>();
  for (const e of activeEventsNoStock) {
    if (!e.movieId) continue;
    if (!isObtainable(e.eventName, e.releaseDate, date)) continue;
    if (eventTheaters.has(e.eventId)) continue; // 진행 극장 데이터 있음 → 지점 단위로 처리됨
    pushEntry(unknownChainEntries, `${e.movieId}-${e.chain}`, {
      type: e.goodieType,
      fmt: requiredFormat(e.eventName),
    });
  }

  // 3) 영화 목록 (중복 제거)
  const movieMap = new Map<number, MovieMini>();
  for (const r of rows) {
    if (r.movieId && !movieMap.has(r.movieId)) {
      movieMap.set(r.movieId, {
        id: r.movieId,
        title: r.movieTitle ?? "제목 없음",
        posterUrl: r.posterUrl ?? null,
      });
    }
  }

  // 4) updatedAt 최신값 (상영 / 굿즈 각각)
  let latestUpdate = "";
  for (const r of rows) {
    if (r.updatedAt && r.updatedAt > latestUpdate) latestUpdate = r.updatedAt;
  }

  let latestGoodsUpdate = "";
  for (const r of activeStockRows) {
    // goodsStock에는 updatedAt이 없으므로 activeStockRows 쿼리에 추가 필요
  }
  // goods_stock의 최신 updatedAt 별도 조회
  const [goodsLatest] = await db
    .select({ latest: sql<string>`MAX(${goodsStock.updatedAt})` })
    .from(goodsStock);
  const goodsUpdatedAt = goodsLatest?.latest ?? "";

  // 5) 카드 변환
  const cards: ScreeningCard[] = rows.map((r) => {
    // 지점 단위 특전 + 지점 미확인 이벤트(체인 공통)의 합집합.
    // 포맷 전용 특전은 이 회차의 포맷이 맞을 때만 (노출 규칙 ④)
    const tKey = `${r.movieId}-${r.theaterId}`;
    const cKey = `${r.movieId}-${r.chain}`;
    const types = new Set(
      [
        ...(entriesByTheater.get(tKey) ?? []),
        ...(unknownChainEntries.get(cKey) ?? []),
      ]
        .filter((en) => formatSatisfies(en.fmt, r.format))
        .map((en) => en.type)
    );
    const eventTypes = [...types] as GoodieType[];

    return {
      id: r.id,
      movie: {
        id: r.movieId ?? 0,
        title: r.movieTitle ?? "제목 없음",
        posterUrl: r.posterUrl ?? null,
      },
      theater: {
        id: r.theaterId,
        chain: r.chain as ScreeningCard["theater"]["chain"],
        branchName: r.branchName ?? "",
        region: r.region ?? null,
      },
      startTime: r.startTime,
      endTime: r.endTime ?? null,
      screenName: r.screenName ?? null,
      format: r.format ?? null,
      subtitleDub: r.subtitleDub ?? null,
      remainingSeats: r.remainingSeats ?? null,
      totalSeats: r.totalSeats ?? null,
      hasEvent: eventTypes.length > 0,
      eventTypes,
      bookingUrl: r.bookingUrl ?? null,
    };
  });

  // 6) 커버리지 (지점 수 + 극장 목록 + 지역 그룹)
  // 선택 날짜에 회차가 있는 극장 = "상영 중". 카탈로그로만 추가된 곳은 그 날 "쉬는 날".
  const openTheaterIds = new Set(rows.map((r) => r.theaterId));
  const theaterInfoMap = new Map<number, { id: number; chain: string; branchName: string }>();
  for (const r of rows) {
    if (!theaterInfoMap.has(r.theaterId)) {
      theaterInfoMap.set(r.theaterId, { id: r.theaterId, chain: r.chain, branchName: r.branchName ?? "" });
    }
  }

  // 독립관은 해당 날짜에 회차가 없어도 필터에서 사라지지 않게 v1 전체 카탈로그를 합친다.
  // 아직 theaters 행이 만들어지지 않은 관은 충돌하지 않는 음수 ID를 사용한다.
  const indieRows = await db
    .select({
      id: theaters.id,
      branchName: theaters.branchName,
      chainBranchCode: theaters.chainBranchCode,
    })
    .from(theaters)
    .where(eq(theaters.chain, "INDIE"));
  const indieByCode = new Map(indieRows.map((t) => [t.chainBranchCode, t]));
  INDIE_THEATERS.forEach((catalog, index) => {
    const stored = indieByCode.get(`ig-${catalog.handle}`);
    const id = stored?.id ?? -(index + 1);
    if (!theaterInfoMap.has(id)) {
      theaterInfoMap.set(id, {
        id,
        chain: "INDIE",
        branchName: stored?.branchName ?? catalog.theaterName,
      });
    }
  });

  // 극장 카드의 마지막 수집 상태. 선택 날짜에 일정이 없는 극장도 이전 수집
  // 기록을 확인할 수 있도록 날짜와 무관하게 극장별 최신 갱신 시각을 집계한다.
  const theaterUpdateRows = await db
    .select({
      theaterId: screenings.theaterId,
      updatedAt: sql<string | null>`MAX(${screenings.updatedAt})`,
    })
    .from(screenings)
    .innerJoin(theaters, eq(screenings.theaterId, theaters.id))
    .where(branchFilter)
    .groupBy(screenings.theaterId);
  const theaterUpdatedAt = new Map(theaterUpdateRows.map((row) => [row.theaterId, row.updatedAt]));

  // 지역 그룹핑
  const AREA_RULES: { label: string; keywords: string[] }[] = [
    { label: "일산·고양", keywords: ["일산", "고양", "화정", "행신", "백석", "스타필드", "라페스타", "킨텍스"] },
    { label: "파주", keywords: ["파주", "운정", "금촌"] },
    { label: "서울 서부", keywords: ["영등포", "목동", "신촌", "홍대", "상암"] },
  ];

  function getArea(name: string): string {
    for (const rule of AREA_RULES) {
      if (rule.keywords.some((kw) => name.includes(kw))) return rule.label;
    }
    return "기타";
  }

  const theaterList = [...theaterInfoMap.values()]
    .map((t) => ({
      ...t,
      area: t.chain === "INDIE" ? "독립영화관" : getArea(t.branchName),
      openToday: openTheaterIds.has(t.id), // 그 날 상영 있음 여부 (없으면 필터에 '쉼' 표시)
      updatedAt: theaterUpdatedAt.get(t.id) ?? null,
    }))
    .sort((a, b) => a.area.localeCompare(b.area) || a.branchName.localeCompare(b.branchName));

  // 서비스 대상 극장의 날짜별 등록 범위. 날짜 칩에서 "몇 개 극장 일정이
  // 실제로 들어왔는지"를 보여주고, 먼 미래의 일부 일정만 전체처럼 보이지 않게 한다.
  // 최대 21일만 노출하므로 그 이후 데이터는 홈 응답에 싣지 않는다.
  const coverageEnd = addDays(today, 20);
  const dateCoverage = await db
    .select({
      date: screenings.playDate,
      screeningCount: sql<number>`COUNT(*)`,
      theaterCount: sql<number>`COUNT(DISTINCT ${screenings.theaterId})`,
      indieTheaterCount: sql<number>`COUNT(DISTINCT CASE WHEN ${theaters.chain} = 'INDIE' THEN ${screenings.theaterId} END)`,
    })
    .from(screenings)
    .innerJoin(theaters, eq(screenings.theaterId, theaters.id))
    .where(
      and(
        sql`${screenings.playDate} >= ${today}`,
        sql`${screenings.playDate} <= ${coverageEnd}`,
        branchFilter,
      )
    )
    .groupBy(screenings.playDate)
    .orderBy(screenings.playDate);

  const maxDate = dateCoverage.at(-1)?.date ?? null;

  if (homeSummary) {
    const cutoff = date === today ? nowKSTHHMM() : "00:00";
    const upcomingMovies: ScreeningCard[] = [];
    const seenUpcoming = new Set<number>();
    const goodieMovies: ScreeningCard[] = [];
    const seenGoodies = new Set<number>();
    const indieMap = new Map<number, { theater: ScreeningCard["theater"]; screeningCount: number; next: string | null }>();

    for (const card of cards) {
      if (
        upcomingMovies.length < 6 &&
        card.startTime >= cutoff &&
        !seenUpcoming.has(card.movie.id)
      ) {
        seenUpcoming.add(card.movie.id);
        upcomingMovies.push(card);
      }

      if (goodieMovies.length < 5 && card.hasEvent && !seenGoodies.has(card.movie.id)) {
        seenGoodies.add(card.movie.id);
        goodieMovies.push(card);
      }

      if (card.theater.chain === "INDIE") {
        const summary = indieMap.get(card.theater.id) ?? {
          theater: card.theater,
          screeningCount: 0,
          next: null,
        };
        summary.screeningCount += 1;
        if (card.startTime >= cutoff && (!summary.next || card.startTime < summary.next)) {
          summary.next = card.startTime;
        }
        indieMap.set(card.theater.id, summary);
      }
    }

    const indieTheaters = [...indieMap.values()]
      .sort((a, b) => {
        if (a.next && b.next) return a.next.localeCompare(b.next);
        if (a.next) return -1;
        if (b.next) return 1;
        return a.theater.branchName.localeCompare(b.theater.branchName);
      })
      .slice(0, 5);

    return NextResponse.json({
      date,
      coverage: {
        label: "파주 · 일산 · 고양 · 서울 서부",
        theaterCount: theaterInfoMap.size,
        maxDate,
        dateCoverage: dateCoverage.map((item) => ({
          date: item.date,
          screeningCount: Number(item.screeningCount),
          theaterCount: Number(item.theaterCount),
          indieTheaterCount: Number(item.indieTheaterCount),
        })),
      },
      updatedAt: latestUpdate || new Date().toISOString(),
      goodsUpdatedAt: goodsUpdatedAt || new Date().toISOString(),
      upcomingMovies,
      goodieMovies,
      indieTheaters,
    }, { headers: SNAPSHOT_CACHE_HEADERS });
  }

  const result = {
    date,
    coverage: {
      label: "파주 · 일산 · 고양 · 서울 서부",
      theaterCount: theaterInfoMap.size,
      theaters: theaterList,
      maxDate,
      dateCoverage: dateCoverage.map((item) => ({
        date: item.date,
        screeningCount: Number(item.screeningCount),
        theaterCount: Number(item.theaterCount),
        indieTheaterCount: Number(item.indieTheaterCount),
      })),
    },
    updatedAt: latestUpdate || new Date().toISOString(),
    goodsUpdatedAt: goodsUpdatedAt || new Date().toISOString(),
    movies: [...movieMap.values()],
    screenings: cards,
    eventPreviews,
    goodieStock,
  };

  return NextResponse.json(result, { headers: SNAPSHOT_CACHE_HEADERS });
}

function todayKST(): string {
  const now = new Date();
  // KST = UTC+9
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function nowKSTHHMM(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(11, 16);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
