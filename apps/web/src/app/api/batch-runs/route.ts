import { NextResponse } from "next/server";
import { db, crawlRuns, events, screenings, rawPosts } from "@cinemo/shared";
import { desc, eq, sql } from "drizzle-orm";
import { withDbRetry } from "@/lib/db-retry";

/** Turso 순간 단절 흡수 — 핸들러 전체 재시도 (읽기 전용이라 안전) */
export function GET() {
  return withDbRetry(() => handleGet());
}

/**
 * 배치 실행 기록(crawl_runs) — 로컬 인스타 배치가 각 PC에서 언제·성공/실패·몇 건 걷었는지.
 * 최근 40건 + 기계별 최신 1건 요약(회사맥/회사데탑 구분).
 */
async function handleGet() {
  const runs = await db
    .select({
      source: crawlRuns.source,
      machine: crawlRuns.machine,
      startedAt: crawlRuns.startedAt,
      finishedAt: crawlRuns.finishedAt,
      status: crawlRuns.status,
      events: crawlRuns.events,
      screenings: crawlRuns.screenings,
      detail: crawlRuns.detail,
    })
    .from(crawlRuns)
    .orderBy(desc(crawlRuns.id))
    .limit(40);

  // 기계별 최신 1건 (runs가 최신순이라 처음 만난 게 최신)
  const seen = new Set<string>();
  const byMachine = runs.filter((r) => {
    if (seen.has(r.machine)) return false;
    seen.add(r.machine);
    return true;
  });

  // 누적 수집량 + 마지막 신규 수집 시각 — per-run 0("신규 없음")이 "비어있음"으로 오해되지 않게.
  const cnt = sql<number>`count(*)`;
  const [[ev], [sc], [last]] = await Promise.all([
    db.select({ c: cnt }).from(events).where(eq(events.chain, "INDIE")),
    db.select({ c: cnt }).from(screenings).where(eq(screenings.chain, "INDIE")),
    db
      .select({ t: sql<string | null>`max(${rawPosts.createdAt})` })
      .from(rawPosts)
      .where(eq(rawPosts.source, "INSTA")),
  ]);
  const totals = {
    indieEvents: ev?.c ?? 0,
    indieScreenings: sc?.c ?? 0,
    lastCollectedAt: last?.t ?? null, // 마지막으로 새 인스타 게시물을 담은 시각
  };

  return NextResponse.json(
    { runs, byMachine, totals },
    { headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" } }
  );
}
