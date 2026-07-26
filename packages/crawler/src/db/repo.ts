/**
 * 공용 적재 계층
 *
 * 정규화된 CollectedEvent[]를 받아 DB에 upsert한다.
 * - raw_posts: 원본 응답 아카이빙 (append)
 * - movies:    이름으로 즉석 생성/매칭
 * - events / goodies / theaters / goods_stock: 자연키 기준 upsert (재실행 중복 방지)
 */

import {
  db,
  events,
  goodies,
  goodsStock,
  theaters,
  rawPosts,
  screenings,
} from "@cinemo/shared";
import type {
  Chain,
  CollectedEvent,
  CollectedGoodie,
  CollectedScreening,
  CollectedStock,
  IngestStats,
  ScreeningStats,
} from "../domain";
import { lt, and, eq } from "drizzle-orm";
import { classifyGoodieType, findOrCreateMovie, findMovieOnly } from "./movie-match";

/** 원본 응답을 raw_posts에 보관 (감사/재파싱용, append-only) */
export async function saveRaw(
  source: string,
  sourceId: string,
  raw: unknown,
  imageUrls?: string[]
): Promise<void> {
  await db.insert(rawPosts).values({
    source,
    sourceId,
    rawJson: JSON.stringify(raw),
    imageUrls: imageUrls && imageUrls.length ? JSON.stringify(imageUrls) : null,
    parseStatus: "parsed",
    parsedAt: new Date().toISOString(),
  });
}

/** 원본이 이미 보관됐는지 (인스타 수집 dedup — 게시물 ID 기준) */
export async function existsRaw(source: string, sourceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: rawPosts.id })
    .from(rawPosts)
    .where(and(eq(rawPosts.source, source), eq(rawPosts.sourceId, sourceId)))
    .limit(1);
  return !!row;
}

// 체인+지점코드 → theaterId 캐시 (한 번의 ingest 안에서 중복 upsert 방지)
const theaterCache = new Map<string, number>();

/** 지점 upsert (chain, chain_branch_code) 기준 */
export async function upsertTheater(
  chain: Chain,
  s: { branchCode: string; branchName: string; region?: string }
): Promise<number> {
  const cacheKey = `${chain}:${s.branchCode}`;
  const cached = theaterCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const [row] = await db
    .insert(theaters)
    .values({
      chain,
      branchName: s.branchName,
      region: s.region ?? null,
      chainBranchCode: s.branchCode,
    })
    .onConflictDoUpdate({
      target: [theaters.chain, theaters.chainBranchCode],
      set: { branchName: s.branchName, region: s.region ?? null },
    })
    .returning({ id: theaters.id });

  theaterCache.set(cacheKey, row.id);
  return row.id;
}

/** 이벤트 upsert (chain, source_event_id) 기준 */
export async function upsertEvent(
  chain: Chain,
  ev: CollectedEvent,
  movieId: number | null
): Promise<number> {
  const detailImageUrls =
    ev.detailImageUrls && ev.detailImageUrls.length
      ? JSON.stringify(ev.detailImageUrls)
      : null;

  // 기존 movieId를 null로 덮어쓰지 않도록, 매칭됐을 때만 set에 포함
  const set: Record<string, unknown> = {
    eventName: ev.eventName,
    startDate: ev.startDate,
    endDate: ev.endDate,
    sourceUrl: ev.sourceUrl ?? null,
    imageUrl: ev.imageUrl ?? null,
  };
  if (movieId != null) set.movieId = movieId;
  // 상세 이미지도 있을 때만 갱신 (일시적 수집 실패로 기존 값 지우지 않기)
  if (detailImageUrls) set.detailImageUrls = detailImageUrls;
  if (ev.category) set.category = ev.category;

  const [row] = await db
    .insert(events)
    .values({
      chain,
      sourceEventId: ev.sourceEventId,
      eventName: ev.eventName,
      startDate: ev.startDate,
      endDate: ev.endDate,
      sourceUrl: ev.sourceUrl ?? null,
      imageUrl: ev.imageUrl ?? null,
      detailImageUrls,
      category: ev.category ?? null,
      movieId,
    })
    .onConflictDoUpdate({
      target: [events.chain, events.sourceEventId],
      set,
    })
    .returning({ id: events.id });

  return row.id;
}

/** 굿즈 upsert (event_id, source_goods_id) 기준 */
export async function upsertGoodie(
  eventId: number,
  g: CollectedGoodie
): Promise<number> {
  const type = g.type ?? classifyGoodieType(g.name);
  // 원본 굿즈 ID가 없으면 이름을 자연키로 대체해 dedup 유지
  const sourceGoodsId = g.sourceGoodsId ?? g.name;

  const [row] = await db
    .insert(goodies)
    .values({
      eventId,
      name: g.name,
      type,
      imageUrl: g.imageUrl ?? null,
      sourceGoodsId,
    })
    .onConflictDoUpdate({
      target: [goodies.eventId, goodies.sourceGoodsId],
      set: { name: g.name, type, imageUrl: g.imageUrl ?? null },
    })
    .returning({ id: goodies.id });

  return row.id;
}

/** 소진 현황 upsert (goodie_id, theater_id) 기준 */
export async function upsertStock(
  goodieId: number,
  theaterId: number,
  s: CollectedStock
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(goodsStock)
    .values({
      goodieId,
      theaterId,
      status: s.status,
      remainingQty: s.remainingQty ?? null,
      totalQty: s.totalQty ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [goodsStock.goodieId, goodsStock.theaterId],
      set: {
        status: s.status,
        remainingQty: s.remainingQty ?? null,
        totalQty: s.totalQty ?? null,
        updatedAt: now,
      },
    });
}

/**
 * 정규화된 이벤트 배열을 DB에 적재한다.
 * 이벤트 → (원본 보관 · 영화 매칭 · 굿즈 · 지점 · 소진현황) 순으로 upsert.
 */
export async function ingest(
  chain: Chain,
  collected: CollectedEvent[]
): Promise<IngestStats> {
  const stats: IngestStats = {
    events: 0,
    goodies: 0,
    stock: 0,
    theaters: 0,
    moviesLinked: 0,
    skipped: 0,
  };
  let consecutiveFailures = 0;

  for (const ev of collected) {
    // 이벤트 단위 재시도 + 스킵 — 일시적 DB 단절이 배치 전체를 죽이지 않게 (모두 upsert = 멱등)
    try {
      await withWriteRetry(async () => {
        await saveRaw(
          chain,
          ev.sourceEventId,
          ev.raw,
          ev.imageUrl ? [ev.imageUrl] : undefined
        );

        const movieId = ev.movieTitle
          ? ev.linkMovieOnly
            ? await findMovieOnly(ev.movieTitle) // 일반 이벤트: 기존 영화만 연결
            : await findOrCreateMovie(ev.movieTitle)
          : null;

        const eventId = await upsertEvent(chain, ev, movieId);

        let goodies = 0;
        let stock = 0;
        for (const g of ev.goodies) {
          const goodieId = await upsertGoodie(eventId, g);
          goodies++;

          for (const s of g.stock) {
            const theaterId = await upsertTheater(chain, s);
            await upsertStock(goodieId, theaterId, s);
            stock++;
          }
        }
        // 통계는 성공 시에만 반영 (재시도 중복 집계 방지)
        if (movieId != null) stats.moviesLinked++;
        stats.events++;
        stats.goodies += goodies;
        stats.stock += stock;
      });
      consecutiveFailures = 0;
    } catch (err) {
      stats.skipped++;
      consecutiveFailures++;
      console.error(
        `  ⚠️ 이벤트 적재 스킵 [${ev.eventName.slice(0, 30)}]: ${(err as Error).message.slice(0, 120)}`
      );
      if (consecutiveFailures >= 5) {
        throw new Error(
          `이벤트 적재 연속 ${consecutiveFailures}회 실패 — DB 장애 추정 (마지막: ${(err as Error).message.slice(0, 150)})`
        );
      }
    }
  }

  stats.theaters = theaterCache.size;
  return stats;
}

/** 상영 회차 upsert (chain, theater, 날짜, 시간, 상영관, 영화코드) 기준 */
export async function upsertScreening(
  screening: CollectedScreening,
  theaterId: number,
  movieId: number | null
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(screenings)
    .values({
      movieId,
      theaterId,
      chain: screening.chain,
      playDate: screening.playDate,
      startTime: screening.startTime,
      endTime: screening.endTime ?? null,
      screenName: screening.screenName ?? null,
      format: screening.format ?? null,
      subtitleDub: screening.subtitleDub ?? null,
      sourceMovieCode: screening.sourceMovieCode ?? null,
      remainingSeats: screening.remainingSeats ?? null,
      totalSeats: screening.totalSeats ?? null,
      bookingUrl: screening.bookingUrl ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        screenings.chain,
        screenings.theaterId,
        screenings.playDate,
        screenings.startTime,
        screenings.screenName,
        screenings.sourceMovieCode,
      ],
      set: {
        movieId: movieId ?? undefined,
        endTime: screening.endTime ?? null,
        format: screening.format ?? null,
        subtitleDub: screening.subtitleDub ?? null,
        remainingSeats: screening.remainingSeats ?? null,
        totalSeats: screening.totalSeats ?? null,
        bookingUrl: screening.bookingUrl ?? null,
        updatedAt: now, // 매 수집마다 신선도 갱신
      },
    });
}

/** 오늘(기준일) 이전의 지난 상영 회차 정리 */
export async function deletePastScreenings(beforeDate: string): Promise<number> {
  const res = await db.delete(screenings).where(lt(screenings.playDate, beforeDate));
  return res.rowsAffected ?? 0;
}

/**
 * DB 쓰기 재시도 (일시적 커넥션 단절 대비).
 * 2026-07-17 크론 실패 원인: 수천 행 적재 중 1행에서 순간 단절 → 체인 전체 실패.
 * upsert는 멱등이므로 재시도 안전.
 */
async function withWriteRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 1000 * i)); // 1s, 2s
    }
  }
  throw lastErr;
}

/** 정규화된 상영 회차 배열을 적재 (지점·영화 매칭 재사용) */
export async function ingestScreenings(
  chain: Chain,
  list: CollectedScreening[]
): Promise<ScreeningStats> {
  const stats: ScreeningStats = { screenings: 0, theaters: 0, moviesLinked: 0, skipped: 0 };
  // 영화 제목 → movieId 캐시 (동일 영화 반복 조회 방지)
  const movieCache = new Map<string, number | null>();
  let consecutiveFailures = 0;

  for (const s of list) {
    try {
      await withWriteRetry(async () => {
        const theaterId = await upsertTheater(chain, s);

        let movieId: number | null;
        if (movieCache.has(s.movieTitle)) {
          movieId = movieCache.get(s.movieTitle)!;
        } else {
          movieId = await findOrCreateMovie(s.movieTitle);
          movieCache.set(s.movieTitle, movieId);
        }

        await upsertScreening(s, theaterId, movieId);
      });
      stats.screenings++;
      consecutiveFailures = 0;
    } catch (err) {
      // 재시도까지 실패한 행은 스킵 (한 행이 배치 전체를 죽이지 않게)
      stats.skipped++;
      consecutiveFailures++;
      console.error(
        `  ⚠️ 상영 적재 스킵 [${s.branchName} ${s.playDate} ${s.startTime}]: ${(err as Error).message.slice(0, 120)}`
      );
      // 연속 실패가 이어지면 DB 자체 장애 → 조기 중단
      if (consecutiveFailures >= 5) {
        throw new Error(
          `상영 적재 연속 ${consecutiveFailures}회 실패 — DB 장애 추정 (마지막: ${(err as Error).message.slice(0, 150)})`
        );
      }
    }
  }

  stats.theaters = theaterCache.size;
  // 연결된 서로 다른 영화 수 (중복 제거)
  stats.moviesLinked = new Set(
    [...movieCache.values()].filter((v): v is number => v != null)
  ).size;
  return stats;
}
