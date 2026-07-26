import { NextResponse } from "next/server";
import { db } from "@cinemo/shared";
import { movies, events, goodies, goodsStock, theaters } from "@cinemo/shared";
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
      branchName: theaters.branchName,
      status: goodsStock.status,
    })
    .from(events)
    .innerJoin(goodies, eq(goodies.eventId, events.id))
    .innerJoin(goodsStock, eq(goodsStock.goodieId, goodies.id))
    .innerJoin(theaters, eq(goodsStock.theaterId, theaters.id))
    .where(sql`${events.endDate} >= ${today}`);

  const stockByEvent = new Map<number, { total: Set<string>; corridor: Set<string>; alive: Set<string> }>();
  for (const s of stockRows) {
    let e = stockByEvent.get(s.eventId);
    if (!e) {
      e = { total: new Set(), corridor: new Set(), alive: new Set() };
      stockByEvent.set(s.eventId, e);
    }
    e.total.add(s.branchName);
    if (s.status !== "소진") {
      e.alive.add(s.branchName);
      if (isCorridorBranch(s.branchName)) e.corridor.add(s.branchName);
    }
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
      };
      map.set(r.eventId, ev);
    }
    if (r.goodieName && !ev.goodieNames.includes(r.goodieName)) ev.goodieNames.push(r.goodieName);
    if (r.goodieType && !ev.types.includes(r.goodieType)) ev.types.push(r.goodieType);
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
