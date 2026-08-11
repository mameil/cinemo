"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ScreeningCard, MovieMini, EventPreview, GoodieStockLite } from "@mock/types";
import { CHAIN_COLOR, GOODIE_BADGE_CLASS, GOODIE_CHIP_CLASS, cleanGoodieName, seatStatus, shortScreenName } from "@/lib/utils";
import { requiredFormat, formatSatisfies } from "@/lib/event-rules";
import EventPeek, { type PeekTarget } from "@/components/EventPeek";
import Link from "next/link";

interface MovieGroup {
  movie: MovieMini;
  screenings: ScreeningCard[];
  eventTypes: string[];
  byTheater: { key: string; chain: string; name: string; items: ScreeningCard[] }[];
}

type MovieSort = "next" | "popular" | "title" | "goodie";
const INITIAL_MOVIE_COUNT = 12;
const MOVIE_BATCH_SIZE = 8;

function nextTime(group: MovieGroup, cutoff: string): string | null {
  return group.screenings
    .map((screening) => screening.startTime)
    .filter((time) => time >= cutoff)
    .sort()[0] ?? null;
}

function groupByMovie(screenings: ScreeningCard[], sort: MovieSort, cutoff: string): MovieGroup[] {
  const map = new Map<number, MovieGroup>();
  for (const s of screenings) {
    let g = map.get(s.movie.id);
    if (!g) {
      g = { movie: s.movie, screenings: [], eventTypes: [], byTheater: [] };
      map.set(s.movie.id, g);
    }
    g.screenings.push(s);
    for (const t of s.eventTypes) {
      if (!g.eventTypes.includes(t)) g.eventTypes.push(t);
    }
    const tKey = `${s.theater.chain}-${s.theater.branchName}`;
    let th = g.byTheater.find((t) => t.key === tKey);
    if (!th) {
      th = { key: tKey, chain: s.theater.chain, name: s.theater.branchName, items: [] };
      g.byTheater.push(th);
    }
    th.items.push(s);
  }
  return [...map.values()].sort((a, b) => {
    const aNext = nextTime(a, cutoff);
    const bNext = nextTime(b, cutoff);
    const byNext = (aNext ?? "99:99").localeCompare(bNext ?? "99:99");
    if (sort === "popular") return b.screenings.length - a.screenings.length || byNext;
    if (sort === "title") return a.movie.title.localeCompare(b.movie.title, "ko");
    if (sort === "goodie") {
      return Number(b.eventTypes.length > 0) - Number(a.eventTypes.length > 0) || byNext;
    }
    return byNext || b.screenings.length - a.screenings.length;
  });
}

/**
 * 시간 칩 — 시간 + 좌석 2줄.
 * 특전 개수를 즉시 구분: 없음=기본 / 1개=틴트+① / 2개 이상=틴트+② (시간 옆 개수 뱃지)
 */
function TimeChip({ s }: { s: ScreeningCard }) {
  const status = seatStatus(s.remainingSeats, s.totalSeats);
  const isSoldout = status === "soldout";
  const isLow = status === "low";
  const goodieCount = s.hasEvent ? s.eventTypes.length : 0;
  const showGoodie = goodieCount > 0 && !isSoldout;

  return (
    <span
      className={`inline-flex flex-col items-center rounded-lg border px-1.5 py-1 min-w-[50px] text-center transition-colors ${
        isSoldout
          ? "border-line opacity-40"
          : showGoodie
            ? GOODIE_CHIP_CLASS // 특전 받는 상영 — 청록 틴트
            : isLow
              ? "border-low/30 bg-low/5"
              : "border-line"
      }`}
    >
      <b className={`text-[13px] tabular-nums leading-none ${isSoldout ? "line-through text-ink-3" : ""}`}>
        {s.startTime}
      </b>
      {s.remainingSeats !== null && s.totalSeats !== null && (
        <small className={`mt-0.5 text-[8.5px] tabular-nums leading-none ${
          isSoldout ? "text-soldout" : isLow ? "text-low font-bold" : "text-ink-3"
        }`}>
          {isSoldout ? "매진" : `${s.remainingSeats}/${s.totalSeats}`}
        </small>
      )}
    </span>
  );
}

/** 재고 → 긴급도 라벨. CGV "141/500" · 롯데 "잔여 23" · 메가 "소량" (보유는 표기 생략) */
function stockQtyLabel(r: GoodieStockLite): { text: string; urgent: boolean } {
  if (r.remaining !== null && r.total !== null && r.total > 0) {
    return { text: `${r.remaining}/${r.total}`, urgent: r.remaining / r.total <= 0.1 };
  }
  if (r.remaining !== null) {
    return { text: `잔여 ${r.remaining}`, urgent: r.status === "소량보유" };
  }
  if (r.status === "소량보유") return { text: "소량", urgent: true };
  if (r.status === "보유") return { text: "보유", urgent: false }; // 메가: 수량 미제공, 상태라도 표기
  return { text: "", urgent: false };
}

/** 극장 내 상영관(포맷·관) 그룹 — 관 이름을 줄에 한 번만 표시 */
function groupByScreen(items: ScreeningCard[]): { label: string; items: ScreeningCard[] }[] {
  const map = new Map<string, ScreeningCard[]>();
  for (const s of items) {
    const fmt =
      s.format && !/^2D$/i.test(s.format)
        ? s.format.replace(/\s*LASER\s*/i, " ").replace(/\s*2D$/i, "").trim()
        : "2D";
    const screen = shortScreenName(s.screenName);
    const label = screen ? `${fmt} · ${screen}` : fmt;
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(s);
  }
  // 첫 상영 시간순 정렬
  return [...map.entries()]
    .map(([label, items]) => ({ label, items }))
    .sort((a, b) => a.items[0].startTime.localeCompare(b.items[0].startTime));
}

function MovieGroupCard({
  g,
  eventPreviews,
  goodieStock,
  onPeek,
  cutoff,
}: {
  g: MovieGroup;
  eventPreviews: Record<string, EventPreview[]>;
  goodieStock: Record<string, GoodieStockLite[]>;
  onPeek: (t: PeekTarget) => void;
  cutoff: string;
}) {
  const collapsedMax = 2;
  const visibleTheaters = g.byTheater.slice(0, collapsedMax);
  const hiddenCount = g.byTheater.length - collapsedMax;
  const next = nextTime(g, cutoff);

  // 이 영화가 상영 중인 체인들의 미리보기 (요약 클릭용)
  const chainEntries = [...new Set(g.byTheater.map((t) => t.chain))]
    .map((chain) => ({ chain, previews: eventPreviews[`${g.movie.id}-${chain}`] ?? [] }))
    .filter((e) => e.previews.length > 0);

  return (
    <div className="rounded-[16px] border border-line bg-panel overflow-hidden">
      {/* 상단: 포스터 + 영화 정보 */}
      <div className="flex gap-3 p-3 pb-2">
        <Link href={`/movies/${g.movie.id}`} className="flex-none">
          {g.movie.posterUrl ? (
            <img
              src={g.movie.posterUrl.replace("/w500/", "/w200/")}
              alt={`${g.movie.title} 포스터`}
              className="h-[80px] w-[55px] rounded-[9px] object-cover bg-[#dfe4ea]"
            />
          ) : (
            <div className="flex h-[80px] w-[55px] items-center justify-center rounded-[9px] bg-[repeating-linear-gradient(135deg,#e7ebf0,#e7ebf0_6px,#eef1f5_6px,#eef1f5_12px)] text-xl text-[#aab1bb]">
              🎞️
            </div>
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link href={`/movies/${g.movie.id}`} className="min-w-0 flex-1">
              <h3 className="truncate text-[16px] font-bold tracking-tight">{g.movie.title}</h3>
            </Link>
            <span className="flex-none text-[11px] font-bold text-ink-3 tabular-nums">
              {g.byTheater.length}곳 · {g.screenings.length}회
            </span>
          </div>

          <p className="mt-1 text-[12px]">
            {next ? (
              <><span className="font-extrabold text-app">다음 {next}</span><span className="ml-1.5 text-ink-3">가장 빠른 상영</span></>
            ) : (
              <span className="font-semibold text-ink-3">오늘 상영 종료</span>
            )}
          </p>

          {/* 특전 요약 (있을 때만) — 클릭 → 전체 미리보기 */}
          {g.eventTypes.length > 0 && (
            <button
              onClick={() =>
                chainEntries.length > 0 &&
                onPeek({ movieTitle: g.movie.title, type: null, entries: chainEntries })
              }
              className="mt-1 text-[11.5px] text-goodie font-semibold hover:underline"
            >
              🎁 특전 {g.eventTypes.length}종 <span className="text-[10px] font-normal text-ink-3">눌러서 보기</span>
            </button>
          )}
        </div>
      </div>

      {/* 극장별 시간표 */}
      <div className="px-3 pb-2">
        {visibleTheaters.map((th) => {
          // 이 극장(체인)에서 받을 수 있는 특전 종류
          const theaterEventTypes = [...new Set(th.items.flatMap((s) => s.eventTypes))];
          const theaterId = th.items[0]?.theater.id;
          // 이 극장이 진행 극장에 포함된 이벤트만 (돌비관 전용 등 타지점 이벤트 제외).
          // theaterIds가 비면 지점 판별 불가 → 표시.
          const chainPreviews = (eventPreviews[`${g.movie.id}-${th.chain}`] ?? []).filter(
            (p) => p.theaterIds.length === 0 || p.theaterIds.includes(theaterId)
          );
          /**
           * 미리보기 열기.
           * - format: 그 포맷 상영에서 받는 특전만 (IMAX 줄 → IMAX 포스터 도안만)
           * - allowedTypes: 배지/줄에 표기된(=이 지점에서 실제 받을 수 있는) 종류만
           *   — 소진된 특전이 모달에 섞여 표기와 어긋나지 않게
           */
          const peekChain = (
            type: string | null,
            format?: string | null,
            label?: string,
            allowedTypes?: Set<string>
          ) =>
            onPeek({
              movieTitle: g.movie.title,
              type,
              theaterName: label ? `${th.name} · ${label}` : th.name,
              entries: [{
                chain: th.chain,
                previews: chainPreviews.filter(
                  (p) =>
                    (format === undefined ||
                      formatSatisfies(requiredFormat(p.eventName), format)) &&
                    (!allowedTypes || allowedTypes.has(p.type))
                ),
              }],
            });

          const typeLabels = theaterEventTypes.map((t) => (t === "기타" ? "이벤트" : t));

          return (
            <div key={th.key} className="mb-2.5 last:mb-0">
              <div className="mb-1 flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full flex-none"
                  style={{ background: CHAIN_COLOR[th.chain as keyof typeof CHAIN_COLOR] }}
                />
                <span className="text-[12px] font-semibold text-ink-2 truncate">{th.name}</span>
                {/* 특전 개수 강조 배지 — 1종/2종을 한눈에 구분 */}
                {theaterEventTypes.length > 0 && (
                  <button
                    onClick={() => peekChain(null, undefined, undefined, new Set(theaterEventTypes))}
                    className={`rounded-full border px-1.5 py-px text-[9.5px] font-bold transition-colors cursor-pointer whitespace-nowrap ${GOODIE_BADGE_CLASS}`}
                  >
                    🎁 {theaterEventTypes.length >= 2 ? `${theaterEventTypes.length}종 · ` : ""}
                    {typeLabels.slice(0, 2).join("·")}
                    {typeLabels.length > 2 && " 외"}
                  </button>
                )}
              </div>
              {/* 상영관별 줄 — 관 이름은 한 번만, 옆에 "이 관에서 보면 받는" 특전 표기.
                  포맷 전용 특전(4DX 포스터 등)은 해당 포맷 줄에만 붙는다 (카드가 이미 포맷 필터됨) */}
              {groupByScreen(th.items).map((sg) => {
                const sgTypeSet = new Set(sg.items.flatMap((s) => s.eventTypes));
                const sgFormat = sg.items[0].format;
                // "뭘 받는지 + 얼마나 남았는지" — 재고 데이터(수량 포함)가 1순위
                const stockItems = (goodieStock[`${g.movie.id}-${theaterId}`] ?? [])
                  .filter(
                    (r) =>
                      sgTypeSet.has(r.type) &&
                      formatSatisfies(requiredFormat(r.eventName), sgFormat)
                  )
                  .map((r) => ({ name: cleanGoodieName(r.name), ...stockQtyLabel(r) }));
                // 지점 미확인 이벤트(재고 데이터 없음) — 이름만, 수량 없음
                const unknownItems = chainPreviews
                  .filter(
                    (p) =>
                      p.theaterIds.length === 0 &&
                      sgTypeSet.has(p.type) &&
                      formatSatisfies(requiredFormat(p.eventName), sgFormat)
                  )
                  .flatMap((p) =>
                    p.goodieNames?.length ? p.goodieNames.map(cleanGoodieName) : [cleanGoodieName(p.eventName)]
                  )
                  .map((name) => ({ name, text: "", urgent: false }));
                // 이름 기준 dedup (재고 항목 우선)
                const seen = new Set<string>();
                const sgItems2 = [...stockItems, ...unknownItems].filter((it) => {
                  if (!it.name || seen.has(it.name)) return false;
                  seen.add(it.name);
                  return true;
                });
                return (
                  <div key={sg.label} className="mb-1 pl-3.5 last:mb-0">
                    <p className="mb-0.5 text-[10px] font-medium text-ink-3">
                      {sg.label}
                      {sgItems2.length > 0 && (
                        <button
                          onClick={() => peekChain(null, sgFormat, sg.label, sgTypeSet)}
                          className="ml-1 font-semibold text-goodie hover:underline cursor-pointer"
                          title="이 상영관에서 받는 특전 도안 보기"
                        >
                          🎁{" "}
                          {sgItems2.slice(0, 2).map((it, i) => (
                            <span key={it.name}>
                              {i > 0 && " · "}
                              {it.name}
                              {it.text && (
                                <span className={it.urgent ? "text-low font-bold" : "text-ink-3 font-normal"}>
                                  {" "}{it.text}
                                </span>
                              )}
                            </span>
                          ))}
                          {sgItems2.length > 2 && ` 외 ${sgItems2.length - 2}`} 증정{" "}
                          <span className="font-normal">보기</span>
                        </button>
                      )}
                    </p>
                    <div className="flex gap-1 overflow-x-auto scrollbar-none">
                      {sg.items.map((s) => (
                        <TimeChip key={s.id} s={s} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* 더보기 / 접기 */}
      {g.byTheater.length > collapsedMax && (
        <Link
          href={`/movies/${g.movie.id}`}
          className="block w-full border-t border-line-soft py-2 text-center text-[11.5px] font-semibold text-ink-3 hover:text-app transition-colors"
        >
          나머지 {hiddenCount}곳 시간표 보기 →
        </Link>
      )}
    </div>
  );
}

export default function MovieGroupView({
  screenings,
  eventPreviews = {},
  goodieStock = {},
  isToday = false,
}: {
  screenings: ScreeningCard[];
  eventPreviews?: Record<string, EventPreview[]>;
  goodieStock?: Record<string, GoodieStockLite[]>;
  isToday?: boolean;
}) {
  const [sort, setSort] = useState<MovieSort>("next");
  const [peek, setPeek] = useState<PeekTarget | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_MOVIE_COUNT);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const now = new Date();
  const cutoff = isToday
    ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    : "00:00";
  const groups = useMemo(() => groupByMovie(screenings, sort, cutoff), [screenings, sort, cutoff]);
  const visibleGroups = groups.slice(0, visibleCount);

  useEffect(() => {
    setVisibleCount(INITIAL_MOVIE_COUNT);
  }, [screenings, sort]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || visibleCount >= groups.length) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleCount((current) => Math.min(current + MOVIE_BATCH_SIZE, groups.length));
        }
      },
      { rootMargin: "320px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [groups.length, visibleCount]);

  return (
    <div className="flex flex-col gap-2.5 p-3">
      <div className="flex items-center gap-2 pb-0.5">
        <b className="text-[12px] text-ink-2">영화 {groups.length}편</b>
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-3">
          정렬
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as MovieSort)}
            className="rounded-lg border border-line bg-panel px-2 py-1 text-[11.5px] font-semibold text-ink outline-none focus:border-app"
          >
            <option value="next">빠른 상영순</option>
            <option value="popular">상영 많은 순</option>
            <option value="title">가나다순</option>
            <option value="goodie">특전 우선</option>
          </select>
        </label>
      </div>
      {visibleGroups.map((g) => (
        <MovieGroupCard key={g.movie.id} g={g} eventPreviews={eventPreviews} goodieStock={goodieStock} onPeek={setPeek} cutoff={cutoff} />
      ))}
      {visibleCount < groups.length && (
        <div ref={loadMoreRef} className="py-2 text-center">
          <button
            type="button"
            onClick={() => setVisibleCount((current) => Math.min(current + MOVIE_BATCH_SIZE, groups.length))}
            className="rounded-full border border-line bg-panel px-4 py-1.5 text-[11px] font-bold text-ink-3 hover:border-app hover:text-app"
          >
            영화 더 보기 · {Math.min(visibleCount, groups.length)}/{groups.length}
          </button>
        </div>
      )}
      {peek && <EventPeek target={peek} onClose={() => setPeek(null)} />}
    </div>
  );
}
