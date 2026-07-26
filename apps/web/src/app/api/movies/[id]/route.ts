import { NextRequest, NextResponse } from "next/server";
import { db } from "@cinemo/shared";
import { movies, events, goodies, goodsStock, screenings, theaters } from "@cinemo/shared";
import { eq, and, sql, or, like, not } from "drizzle-orm";
import { isObtainable } from "@/lib/event-rules";
import { withDbRetry, SNAPSHOT_CACHE_HEADERS } from "@/lib/db-retry";

/** Turso 순간 단절 흡수 — 핸들러 전체 재시도 (읽기 전용이라 안전) */
export function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withDbRetry(() => handleGet(req, ctx));
}

// 코리도 필터 (screenings API와 동일)
const CORRIDOR_KEYWORDS = [
  "일산", "화정", "행신", "운정", "금촌", "라페스타", "킨텍스",
  "영등포", "목동", "신촌", "홍대",
  "고양스타필드", "백석",
];

const EXCLUDE_KEYWORDS = [
  "위례", "문산", "부천", "월드컵경기장", "수원", "안성", "하남",
];

async function handleGet(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const movieId = Number(id);
  if (isNaN(movieId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  // 1) 영화 기본 정보
  const [movie] = await db
    .select()
    .from(movies)
    .where(eq(movies.id, movieId))
    .limit(1);

  if (!movie) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 2) 특전 이벤트 + 굿즈 + 소진현황 (코리도 극장만)
  const includeFilter = or(
    ...CORRIDOR_KEYWORDS.map((kw) => like(theaters.branchName, `%${kw}%`))
  );
  const excludeFilter = and(
    ...EXCLUDE_KEYWORDS.map((kw) => not(like(theaters.branchName, `%${kw}%`)))
  );
  const branchFilter = and(includeFilter, excludeFilter);

  const eventRows = await db
    .select({
      eventId: events.id,
      chain: events.chain,
      eventName: events.eventName,
      startDate: events.startDate,
      endDate: events.endDate,
      sourceUrl: events.sourceUrl,
      imageUrl: events.imageUrl,
      detailImageUrls: events.detailImageUrls,
      goodieId: goodies.id,
      goodieName: goodies.name,
      goodieType: goodies.type,
      goodieImageUrl: goodies.imageUrl,
    })
    .from(events)
    .innerJoin(goodies, eq(goodies.eventId, events.id))
    .where(eq(events.movieId, movieId));

  // 굿즈별 소진현황 (코리도 극장만)
  const goodieIds = [...new Set(eventRows.map((r) => r.goodieId))];
  const stockRows = goodieIds.length > 0
    ? await db
        .select({
          goodieId: goodsStock.goodieId,
          theaterId: goodsStock.theaterId,
          chain: theaters.chain,
          branchName: theaters.branchName,
          region: theaters.region,
          status: goodsStock.status,
          remainingQty: goodsStock.remainingQty,
          totalQty: goodsStock.totalQty,
          updatedAt: goodsStock.updatedAt,
        })
        .from(goodsStock)
        .innerJoin(theaters, eq(goodsStock.theaterId, theaters.id))
        .where(and(
          sql`${goodsStock.goodieId} IN (${sql.join(goodieIds.map(id => sql`${id}`), sql`, `)})`,
          branchFilter,
        ))
    : [];

  // 이벤트 → 굿즈 → stock 조립
  const stockByGoodie = new Map<number, typeof stockRows>();
  for (const s of stockRows) {
    if (!stockByGoodie.has(s.goodieId)) stockByGoodie.set(s.goodieId, []);
    stockByGoodie.get(s.goodieId)!.push(s);
  }

  const eventMap = new Map<number, {
    id: number; chain: string; eventName: string;
    startDate: string; endDate: string; sourceUrl: string | null; imageUrl: string | null;
    detailImages: string[];
    goodies: { id: number; name: string; type: string; imageUrl: string | null; stock: typeof stockRows }[];
  }>();

  const today = todayKST();
  for (const r of eventRows) {
    // 얼리버드류: 개봉 후엔 획득 불가 → 상세에서도 숨김
    if (!isObtainable(r.eventName, movie.releaseDate, today)) continue;
    if (!eventMap.has(r.eventId)) {
      let detailImages: string[] = [];
      try {
        detailImages = r.detailImageUrls ? JSON.parse(r.detailImageUrls) : [];
      } catch {}
      eventMap.set(r.eventId, {
        id: r.eventId, chain: r.chain, eventName: r.eventName,
        startDate: r.startDate, endDate: r.endDate,
        sourceUrl: r.sourceUrl, imageUrl: r.imageUrl,
        detailImages,
        goodies: [],
      });
    }
    const evt = eventMap.get(r.eventId)!;
    // 중복 굿즈 방지
    if (!evt.goodies.some((g) => g.id === r.goodieId)) {
      evt.goodies.push({
        id: r.goodieId, name: r.goodieName, type: r.goodieType,
        imageUrl: r.goodieImageUrl,
        stock: stockByGoodie.get(r.goodieId) ?? [],
      });
    }
  }

  // 3) 상영 시간표 (코리도, 오늘 이후 7일)
  const weekLater = addDays(today, 7);

  const screeningRows = await db
    .select({
      id: screenings.id,
      theaterId: screenings.theaterId,
      chain: screenings.chain,
      branchName: theaters.branchName,
      region: theaters.region,
      playDate: screenings.playDate,
      startTime: screenings.startTime,
      endTime: screenings.endTime,
      screenName: screenings.screenName,
      format: screenings.format,
      remainingSeats: screenings.remainingSeats,
      totalSeats: screenings.totalSeats,
      bookingUrl: screenings.bookingUrl,
    })
    .from(screenings)
    .innerJoin(theaters, eq(screenings.theaterId, theaters.id))
    .where(and(
      eq(screenings.movieId, movieId),
      sql`${screenings.playDate} >= ${today}`,
      sql`${screenings.playDate} <= ${weekLater}`,
      branchFilter,
    ))
    .orderBy(screenings.playDate, screenings.startTime);

  // 날짜별 그룹
  const screeningsByDate: Record<string, typeof screeningRows> = {};
  for (const s of screeningRows) {
    if (!screeningsByDate[s.playDate]) screeningsByDate[s.playDate] = [];
    screeningsByDate[s.playDate].push({
      ...s,
    });
  }

  return NextResponse.json({
    id: movie.id,
    title: movie.title,
    posterUrl: movie.posterUrl,
    releaseDate: movie.releaseDate,
    events: [...eventMap.values()],
    screeningsByDate,
  }, { headers: SNAPSHOT_CACHE_HEADERS });
}

function todayKST(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
