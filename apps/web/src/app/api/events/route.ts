import { NextResponse } from "next/server";
import { db } from "@cinemo/shared";
import { movies, events, goodies, goodsStock, theaters, screenings } from "@cinemo/shared";
import { eq, sql } from "drizzle-orm";
import { isObtainable } from "@/lib/event-rules";
import { isCorridorBranch } from "@/lib/corridor";
import { withDbRetry, SNAPSHOT_CACHE_HEADERS } from "@/lib/db-retry";

/** Turso 순간 단절 흡수 — 핸들러 전체 재시도 (읽기 전용이라 안전) */
export function GET() {
  return withDbRetry(() => handleGet());
}

/**
 * 이벤트 피드 — 3사의 모든 이벤트(특전·영화·상영회·극장·제휴)를 시작일 최신순으로.
 * 범위: 전국 전체. 카드에 "내 지역(코리도) N곳" 표기용 카운트 포함.
 * 노출 규칙 적용: 종료·획득불가(얼리버드×개봉후) 제외, 전국 소진은 플래그.
 */
async function handleGet() {
  const today = todayKST();

  // 이벤트 + 굿즈 + 영화 (진행중 or 예정)
  const rows = await db
    .select({
      eventId: events.id,
      chain: events.chain,
      eventName: events.eventName,
      startDate: events.startDate,
      endDate: events.endDate,
      imageUrl: events.imageUrl,
      detailImageUrls: events.detailImageUrls,
      createdAt: events.createdAt,
      category: events.category,
      sourceUrl: events.sourceUrl,
      goodieName: goodies.name,
      goodieType: goodies.type,
      movieId: movies.id,
      movieTitle: movies.title,
      posterUrl: movies.posterUrl,
      releaseDate: movies.releaseDate,
    })
    .from(events)
    .leftJoin(goodies, eq(goodies.eventId, events.id)) // 일반 이벤트는 굿즈 없음
    .leftJoin(movies, eq(events.movieId, movies.id))
    .where(sql`${events.endDate} >= ${today}`);

  // 이벤트별 진행 극장 (재고 지점) — 전국/코리도/소진 집계
  const stockRows = await db
    .select({
      eventId: events.id,
      theaterId: theaters.id,
      branchName: theaters.branchName,
      status: goodsStock.status,
      updatedAt: goodsStock.updatedAt,
    })
    .from(events)
    .innerJoin(goodies, eq(goodies.eventId, events.id))
    .innerJoin(goodsStock, eq(goodsStock.goodieId, goodies.id))
    .innerJoin(theaters, eq(goodsStock.theaterId, theaters.id))
    .where(sql`${events.endDate} >= ${today}`);

  const stockByEvent = new Map<number, {
    total: Set<string>; corridor: Set<string>; alive: Set<string>; latest: string | null;
  }>();
  for (const s of stockRows) {
    let e = stockByEvent.get(s.eventId);
    if (!e) {
      e = { total: new Set(), corridor: new Set(), alive: new Set(), latest: null };
      stockByEvent.set(s.eventId, e);
    }
    e.total.add(s.branchName);
    if (!e.latest || s.updatedAt > e.latest) e.latest = s.updatedAt;
    if (s.status !== "소진") {
      e.alive.add(s.branchName);
      if (isCorridorBranch(s.branchName)) e.corridor.add(s.branchName);
    }
  }

  // 오늘 상영 회차 — 특전 카드에서 "어디서 몇 시에 받을 수 있는지" 바로 연결.
  // 현재 이후 회차만 사용하고, 이벤트 재고 지점이 확인된 경우 그 지점으로 제한한다.
  const now = nowKSTHHMM();
  const todayRows = await db
    .select({
      movieId: screenings.movieId,
      theaterId: theaters.id,
      branchName: theaters.branchName,
      chain: theaters.chain,
      startTime: screenings.startTime,
    })
    .from(screenings)
    .innerJoin(theaters, eq(screenings.theaterId, theaters.id))
    .where(sql`${screenings.playDate} = ${today} AND ${screenings.startTime} >= ${now}`)
    .orderBy(screenings.startTime);

  const screeningsByMovie = new Map<number, typeof todayRows>();
  for (const row of todayRows) {
    if (!row.movieId) continue;
    const list = screeningsByMovie.get(row.movieId) ?? [];
    list.push(row);
    screeningsByMovie.set(row.movieId, list);
  }

  // 이벤트 단위 조립
  const map = new Map<number, {
    id: number; chain: string; eventName: string; category: string;
    startDate: string; endDate: string; sourceUrl: string | null;
    imageUrl: string | null; detailImages: string[];
    goodieNames: string[]; types: string[];
    movie: { id: number; title: string; posterUrl: string | null } | null;
    corridorCount: number; aliveCount: number; totalCount: number;
    allSoldOut: boolean; isNew: boolean; upcoming: boolean;
    stockState: "confirmed" | "unverified" | "soldout";
    lastCheckedAt: string;
    todayScreenings: { theaterId: number; branchName: string; times: string[] }[];
  }>();

  const newThreshold = Date.now() - 48 * 3600e3; // 수집 48시간 이내 = NEW

  for (const r of rows) {
    // 획득 불가(얼리버드 × 개봉 후)는 피드에서 제외
    if (!isObtainable(r.eventName, r.releaseDate, today)) continue;

    let ev = map.get(r.eventId);
    if (!ev) {
      let detailImages: string[] = [];
      try {
        detailImages = r.detailImageUrls ? JSON.parse(r.detailImageUrls) : [];
      } catch {}
      const st = stockByEvent.get(r.eventId);
      ev = {
        id: r.eventId,
        chain: r.chain,
        eventName: r.eventName,
        // 카테고리 미태깅(재크롤 전) 레거시 행: 굿즈 있으면 특전으로 간주
        category: r.category ?? (r.goodieName ? "특전" : "기타"),
        sourceUrl: r.sourceUrl ?? null,
        startDate: r.startDate,
        endDate: r.endDate,
        imageUrl: r.imageUrl ?? null,
        detailImages,
        goodieNames: [],
        types: [],
        movie: r.movieId
          ? { id: r.movieId, title: r.movieTitle ?? "", posterUrl: r.posterUrl ?? null }
          : null,
        corridorCount: st?.corridor.size ?? 0,
        aliveCount: st?.alive.size ?? 0,
        totalCount: st?.total.size ?? 0,
        allSoldOut: !!st && st.total.size > 0 && st.alive.size === 0,
        isNew: new Date(r.createdAt).getTime() >= newThreshold,
        upcoming: r.startDate > today,
        stockState: st && st.total.size > 0
          ? st.alive.size > 0 ? "confirmed" : "soldout"
          : "unverified",
        lastCheckedAt: st?.latest ?? r.createdAt,
        todayScreenings: [],
      };
      map.set(r.eventId, ev);
    }
    if (r.goodieName && !ev.goodieNames.includes(r.goodieName)) ev.goodieNames.push(r.goodieName);
    if (r.goodieType && !ev.types.includes(r.goodieType)) ev.types.push(r.goodieType);
  }

  for (const ev of map.values()) {
    if (!ev.movie || ev.upcoming || ev.allSoldOut) continue;
    const stock = stockByEvent.get(ev.id);
    const rowsForMovie = screeningsByMovie.get(ev.movie.id) ?? [];
    const grouped = new Map<number, { theaterId: number; branchName: string; times: string[] }>();
    for (const row of rowsForMovie) {
      if (!isCorridorBranch(row.branchName)) continue;
      // 지점 재고 정보가 있으면 현재 소진되지 않은 진행 지점만 노출.
      // 지점 정보가 없으면 이벤트 체인과 같은 극장의 회차를 미확인 상태로 제공.
      if (stock?.total.size) {
        if (!stock.alive.has(row.branchName)) continue;
      } else if (row.chain !== ev.chain) {
        continue;
      }
      const group = grouped.get(row.theaterId) ?? {
        theaterId: row.theaterId,
        branchName: row.branchName,
        times: [],
      };
      if (group.times.length < 3 && !group.times.includes(row.startTime)) group.times.push(row.startTime);
      grouped.set(row.theaterId, group);
    }
    ev.todayScreenings = [...grouped.values()].slice(0, 3);
  }

  // 시작일 최신순 (동일하면 id 내림차순 = 나중 수집 우선)
  const list = [...map.values()].sort(
    (a, b) => b.startDate.localeCompare(a.startDate) || b.id - a.id
  );

  return NextResponse.json({ today, events: list }, { headers: SNAPSHOT_CACHE_HEADERS });
}

function todayKST(): string {
  const kst = new Date(Date.now() + 9 * 3600e3);
  return kst.toISOString().slice(0, 10);
}

function nowKSTHHMM(): string {
  const kst = new Date(Date.now() + 9 * 3600e3);
  return kst.toISOString().slice(11, 16);
}
