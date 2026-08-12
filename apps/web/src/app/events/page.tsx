"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import AppNav from "@/components/AppNav";
import type { Chain } from "@mock/types";
import { CHAIN_COLOR, CHAIN_LABEL, GOODIE_BADGE_CLASS, cleanGoodieName } from "@/lib/utils";
import EventPeek, { type PeekTarget } from "@/components/EventPeek";
import { GiftIcon, FilmIcon, RefreshIcon } from "@/components/icons";

interface FeedEvent {
  id: number;
  chain: string;
  eventName: string;
  category: string;
  sourceUrl: string | null;
  startDate: string;
  endDate: string;
  imageUrl: string | null;
  detailImages: string[];
  goodieNames: string[];
  types: string[];
  movie: { id: number; title: string; posterUrl: string | null } | null;
  corridorCount: number;
  aliveCount: number;
  totalCount: number;
  allSoldOut: boolean;
  isNew: boolean;
  upcoming: boolean;
  stockState: "confirmed" | "unverified" | "soldout";
  lastCheckedAt: string;
  todayScreenings: { theaterId: number; branchName: string; times: string[] }[];
}

const CHAIN_CLASS: Record<string, string> = {
  CGV: "bg-cgv",
  LOTTE: "bg-lotte",
  MEGA: "bg-mega",
  INDIE: "bg-indie",
};

const CHAINS: Chain[] = ["CGV", "LOTTE", "MEGA", "INDIE"];
const CATEGORIES = ["특전", "영화", "상영회", "극장", "제휴", "기타"];

function dday(endDate: string, today: string): string {
  const diff = Math.round(
    (new Date(endDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400e3
  );
  if (diff <= 0) return "오늘까지";
  if (diff === 1) return "내일까지";
  return `D-${diff}`;
}

function stockLabel(event: FeedEvent): { text: string; className: string } {
  if (event.upcoming) return { text: "증정 예정", className: "border-line bg-ground text-ink-3" };
  if (event.stockState === "soldout") return { text: "소진 확인됨", className: "border-soldout/30 bg-soldout/5 text-soldout" };
  if (event.stockState === "confirmed") return { text: "재고 확인됨", className: "border-ok/30 bg-ok/5 text-ok" };
  return { text: "증정 진행 중 · 재고 미확인", className: "border-goodie-line bg-goodie-tint text-goodie" };
}

function checkedAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}분 전 확인`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전 확인`;
  return `${Math.round(hours / 24)}일 전 확인`;
}

export default function EventsFeedPage() {
  const [data, setData] = useState<{ today: string; events: FeedEvent[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [chainFilter, setChainFilter] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"available" | "upcoming" | "soldout" | "all">("available");
  const [view, setView] = useState<"card" | "list">("card");
  const [peek, setPeek] = useState<PeekTarget | null>(null);
  // 관심 없는 영화/이벤트 숨기기 (sessionStorage 유지)
  // 영화 연결된 건 영화 단위로, 없는 건(제휴·극장 등) 이벤트 단위로 숨긴다
  const [excludedMovies, setExcludedMovies] = useState<Set<number>>(new Set());
  const [excludedEvents, setExcludedEvents] = useState<Set<number>>(new Set());
  const [navDate, setNavDate] = useState<string | undefined>();

  useEffect(() => {
    setNavDate(new URLSearchParams(window.location.search).get("date") ?? undefined);
    try {
      const m = sessionStorage.getItem("cinemo-feed-excluded");
      if (m) setExcludedMovies(new Set(JSON.parse(m) as number[]));
      const e = sessionStorage.getItem("cinemo-feed-excluded-events");
      if (e) setExcludedEvents(new Set(JSON.parse(e) as number[]));
    } catch {}
  }, []);

  const toggleIn = (
    setter: React.Dispatch<React.SetStateAction<Set<number>>>,
    storageKey: string,
    id: number
  ) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify([...next]));
      } catch {}
      return next;
    });

  const excludeMovie = (id: number) => toggleIn(setExcludedMovies, "cinemo-feed-excluded", id);
  const excludeEvent = (id: number) =>
    toggleIn(setExcludedEvents, "cinemo-feed-excluded-events", id);
  /** 카드/행의 ✕ — 영화 있으면 영화 단위, 없으면 이벤트 단위 숨김 */
  const hide = (e: FeedEvent) => (e.movie ? excludeMovie(e.movie.id) : excludeEvent(e.id));

  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    fetch("/api/events")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setData(d))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [retryTick]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.events;
    if (scope === "available") list = list.filter((e) => e.category === "특전" && !e.upcoming && !e.allSoldOut);
    else if (scope === "upcoming") list = list.filter((e) => e.category === "특전" && e.upcoming);
    else if (scope === "soldout") list = list.filter((e) => e.allSoldOut);
    if (chainFilter.size > 0) list = list.filter((e) => chainFilter.has(e.chain));
    if (categoryFilter.size > 0) list = list.filter((e) => categoryFilter.has(e.category));
    if (excludedMovies.size > 0) list = list.filter((e) => !e.movie || !excludedMovies.has(e.movie.id));
    if (excludedEvents.size > 0) list = list.filter((e) => !excludedEvents.has(e.id));
    return list;
  }, [data, scope, chainFilter, categoryFilter, excludedMovies, excludedEvents]);

  // 숨긴 항목 (복원 바 표시용) — 필터 전 전체 목록에서 찾음
  const hiddenChips = useMemo(() => {
    if (!data) return [];
    const chips: { kind: "movie" | "event"; id: number; label: string }[] = [];
    const seenMovies = new Set<number>();
    for (const e of data.events) {
      if (e.movie && excludedMovies.has(e.movie.id) && !seenMovies.has(e.movie.id)) {
        seenMovies.add(e.movie.id);
        chips.push({ kind: "movie", id: e.movie.id, label: e.movie.title });
      }
      if (excludedEvents.has(e.id)) {
        chips.push({ kind: "event", id: e.id, label: e.eventName.slice(0, 16) });
      }
    }
    return chips;
  }, [data, excludedMovies, excludedEvents]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setter(next);
  };

  const openPeek = (e: FeedEvent) => {
    setPeek({
      movieTitle: e.movie?.title ?? e.eventName,
      type: null,
      entries: [{
        chain: e.chain,
        previews: [{
          type: (e.types[0] ?? "기타") as never,
          eventName: e.eventName,
          goodieNames: e.goodieNames,
          sourceUrl: e.sourceUrl,
          imageUrl: e.imageUrl,
          detailImages: e.detailImages,
          // 피드는 이벤트 단위 뷰 — 지점 미확인 배지를 띄우지 않기 위한 더미 (재고 있으면)
          theaterIds: e.totalCount > 0 ? [-1] : [],
          startDate: e.startDate,
          endDate: e.endDate,
        }],
      }],
    });
  };

  const resetResultFilters = () => {
    setScope("all");
    setChainFilter(new Set());
    setCategoryFilter(new Set());
    setExcludedMovies(new Set());
    setExcludedEvents(new Set());
    try {
      sessionStorage.removeItem("cinemo-feed-excluded");
      sessionStorage.removeItem("cinemo-feed-excluded-events");
    } catch {}
  };

  return (
    <main className="mx-auto max-w-[980px]">
      {/* 상단 네비 */}
      <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-line bg-panel/95 px-3.5 py-2.5 backdrop-blur-sm">
        <Link href={navDate ? `/?date=${navDate}` : "/"} className="text-lg">←</Link>
        <b className="inline-flex items-center gap-1.5 text-[15px]"><GiftIcon size={14} className="text-goodie" /> 특전</b>
        <span className="text-[11px] text-ink-3">받을 수 있는 특전부터</span>
        {/* 카드/리스트 토글 */}
        <div className="ml-auto inline-flex rounded-[10px] bg-ground p-0.5">
          <button
            onClick={() => setView("card")}
            className={`rounded-lg px-2.5 py-0.5 text-[12px] font-bold ${
              view === "card" ? "bg-panel-2 text-ink shadow-sm" : "text-ink-2"
            }`}
          >
            카드
          </button>
          <button
            onClick={() => setView("list")}
            className={`rounded-lg px-2.5 py-0.5 text-[12px] font-bold ${
              view === "list" ? "bg-panel-2 text-ink shadow-sm" : "text-ink-2"
            }`}
          >
            리스트
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto px-3.5 pt-3">
        {([
          ["available", "오늘 받을 수 있음"],
          ["upcoming", "증정 예정"],
          ["soldout", "소진 확인"],
          ["all", "전체 이벤트"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setScope(key)}
            className={`flex-none rounded-full border px-3 py-1.5 text-[12px] font-bold ${scope === key ? "border-goodie bg-goodie-tint text-goodie" : "border-line bg-panel text-ink-3"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 필터 칩 */}
      <div className="flex flex-wrap gap-1.5 px-3.5 pt-3">
        {CHAINS.map((c) => {
          const active = chainFilter.size === 0 || chainFilter.has(c);
          return (
            <button
              key={c}
              onClick={() => toggle(chainFilter, setChainFilter, c)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                chainFilter.has(c)
                  ? "border-app bg-app-tint text-app"
                  : "border-line bg-panel text-ink-2"
              } ${!active ? "opacity-40" : ""}`}
            >
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: CHAIN_COLOR[c] }} />
              {CHAIN_LABEL[c]}
            </button>
          );
        })}
        <span className="mx-0.5 w-px self-stretch bg-line" />
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => toggle(categoryFilter, setCategoryFilter, c)}
            className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
              categoryFilter.has(c)
                ? "border-goodie bg-goodie-tint text-goodie"
                : "border-line bg-panel text-ink-2"
            }`}
          >
            {c === "특전" ? <><GiftIcon size={11} /> 특전</> : c}
          </button>
        ))}
      </div>

      {/* 숨긴 항목 복원 바 */}
      {hiddenChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-2 text-[11px]">
          <span className="text-ink-3">숨김:</span>
          {hiddenChips.map((c) => (
            <button
              key={`${c.kind}-${c.id}`}
              onClick={() => (c.kind === "movie" ? excludeMovie(c.id) : excludeEvent(c.id))}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 text-ink-2 line-through hover:border-app hover:text-app hover:no-underline transition-colors"
              title="다시 보기"
            >
              {c.kind === "movie" && <FilmIcon size={10} />}{c.label} <span className="text-[10px] no-underline">↩</span>
            </button>
          ))}
          <button
            onClick={() => {
              setExcludedMovies(new Set());
              setExcludedEvents(new Set());
              try {
                sessionStorage.removeItem("cinemo-feed-excluded");
                sessionStorage.removeItem("cinemo-feed-excluded-events");
              } catch {}
            }}
            className="text-ink-3 hover:text-app"
          >
            모두 해제
          </button>
        </div>
      )}

      {/* 피드 그리드 */}
      {loading ? (
        <div className="py-20 text-center text-sm text-ink-3" role="status">특전을 불러오는 중…</div>
      ) : loadError ? (
        <div className="py-20 text-center text-sm text-ink-3" role="alert">
          데이터를 불러오지 못했어요 (일시적인 문제일 수 있어요)
          <br />
          <button
            onClick={() => setRetryTick((t) => t + 1)}
            className="mt-3 rounded-full border border-line bg-panel px-4 py-1.5 text-xs font-semibold text-ink-2 hover:border-app hover:text-app transition-colors"
          >
            <RefreshIcon size={12} /> 다시 시도
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-sm text-ink-3" role="status">
          조건에 맞는 특전이 없어요
          <br />
          <button
            type="button"
            onClick={resetResultFilters}
            className="mt-3 rounded-full border border-line bg-panel px-4 py-1.5 text-xs font-semibold text-ink-2 hover:border-goodie hover:text-goodie"
          >
            전체 특전 보기
          </button>
        </div>
      ) : view === "list" ? (
        /* 리스트 뷰 — 한 줄에 하나, 훑기용 */
        <div className="flex flex-col gap-1.5 p-3">
          {filtered.map((e) => {
            const thumb = e.detailImages[0] ?? e.imageUrl ?? e.movie?.posterUrl ?? null;
            const mainName = cleanGoodieName(e.goodieNames[0] ?? e.eventName) || e.eventName;
            const status = stockLabel(e);
            return (
              <div
                key={e.id}
                onClick={() => openPeek(e)}
                className={`flex items-center gap-2.5 rounded-xl border border-line bg-panel p-2 text-left cursor-pointer transition-colors hover:border-goodie-line ${
                  e.allSoldOut ? "opacity-55" : ""
                }`}
              >
                {/* 썸네일 */}
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    loading="lazy"
                    className="h-14 w-14 flex-none rounded-lg object-cover object-top bg-ground"
                  />
                ) : (
                  <div className="flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-[repeating-linear-gradient(135deg,#1d252c,#1d252c_6px,#161d24_6px,#161d24_12px)] text-ink-3">
                    <GiftIcon size={16} />
                  </div>
                )}
                {/* 본문 */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 flex-none rounded-full"
                      style={{ background: CHAIN_COLOR[e.chain as Chain] ?? "var(--color-indie)" }}
                    />
                    <p className="truncate text-[13px] font-semibold">{mainName}</p>
                    {e.isNew && (
                      <span className="flex-none rounded bg-soldout px-1 py-px text-[10px] font-bold text-white">NEW</span>
                    )}
                    {e.upcoming && (
                      <span className="flex-none rounded bg-ink px-1 py-px text-[10px] font-bold text-ground">예정</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-ink-3">
                    {e.types.map((t) => (t === "기타" ? "이벤트" : t)).join("·")}
                    {e.movie && <> · <FilmIcon size={10} /> {e.movie.title}</>}
                  </p>
                  <span className={`mt-1 inline-block rounded-full border px-1.5 py-px text-[10px] font-bold ${status.className}`}>{status.text}</span>
                </div>
                {/* 우측: 기간·지역 */}
                <div className="flex-none text-right text-[11px] leading-snug">
                  <p className={`font-bold ${e.allSoldOut ? "text-soldout" : "text-ink-2"}`}>
                    {e.allSoldOut ? "전국 소진" : data ? dday(e.endDate, data.today) : ""}
                  </p>
                  <p className="text-ink-3">
                    {e.corridorCount > 0
                      ? `내 지역 ${e.corridorCount}곳`
                      : e.totalCount > 0
                        ? "내 지역 미진행"
                        : "지점 미확인"}
                  </p>
                </div>
                {/* 숨기기 — 영화 있으면 영화 단위, 없으면 이벤트 단위 */}
                <button
                  onClick={(ev) => {
                    ev.stopPropagation();
                    hide(e);
                  }}
                  className="flex-none self-start px-1 text-[11px] text-ink-3 hover:text-soldout transition-colors"
                  title={e.movie ? "이 영화 숨기기" : "이 이벤트 숨기기"}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((e) => {
            const thumb = e.detailImages[0] ?? e.imageUrl ?? e.movie?.posterUrl ?? null;
            const mainName = cleanGoodieName(e.goodieNames[0] ?? e.eventName) || e.eventName;
            const status = stockLabel(e);
            return (
              <div
                key={e.id}
                className={`overflow-hidden rounded-2xl border border-line bg-panel ${
                  e.allSoldOut ? "opacity-55" : ""
                }`}
              >
                <button onClick={() => openPeek(e)} className="block w-full text-left cursor-pointer">
                  <div className="relative h-44 bg-ground">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={e.eventName}
                        loading="lazy"
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-[repeating-linear-gradient(135deg,#1d252c,#1d252c_8px,#161d24_8px,#161d24_16px)] px-3 text-center text-[11px] text-ink-3">
                        이미지 미제공
                      </div>
                    )}
                    <div className="absolute left-1.5 top-1.5 flex gap-1">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${CHAIN_CLASS[e.chain] ?? "bg-ink-3"}`}>
                        {CHAIN_LABEL[e.chain as Chain] ?? e.chain}
                      </span>
                      {e.isNew && (
                        <span className="rounded bg-soldout px-1.5 py-0.5 text-[10px] font-bold text-white">NEW</span>
                      )}
                      {e.upcoming && (
                        <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold text-ground">예정</span>
                      )}
                    </div>
                    {e.allSoldOut && (
                      <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        전국 소진
                      </span>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="mb-1 flex flex-wrap gap-1">
                      {e.types.slice(0, 2).map((t) => (
                        <span key={t} className={`rounded border px-1 py-px text-[10px] font-bold ${GOODIE_BADGE_CLASS}`}>
                          {t === "기타" ? "이벤트" : t}
                        </span>
                      ))}
                    </div>
                    <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{mainName}</p>
                    {e.movie && <p className="mt-1 truncate text-[11px] font-semibold text-ink-2"><FilmIcon size={10} /> {e.movie.title}</p>}
                    <span className={`mt-1.5 inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${status.className}`}>
                      {status.text}
                    </span>
                    {e.todayScreenings.length > 0 && (
                      <div className="mt-1.5 rounded-lg bg-ground px-2 py-1.5 text-[10px] leading-relaxed text-ink-2">
                        <b>오늘 상영</b>
                        {e.todayScreenings.slice(0, 2).map((screening) => (
                          <p key={screening.theaterId} className="truncate">
                            {screening.branchName} · {screening.times.join(", ")}
                          </p>
                        ))}
                        {e.todayScreenings.length > 2 && <p className="text-ink-3">외 {e.todayScreenings.length - 2}곳</p>}
                      </div>
                    )}
                    <p className="mt-1 text-[11px] text-ink-3">
                      {data ? dday(e.endDate, data.today) : ""}
                      {e.corridorCount > 0
                        ? ` · 내 지역 ${e.corridorCount}곳`
                        : e.totalCount > 0
                          ? " · 내 지역 미진행"
                          : ""}
                    </p>
                  </div>
                </button>
                <div className="flex items-center border-t border-line-soft">
                  {e.movie ? (
                    <Link
                      href={`/movies/${e.movie.id}`}
                      className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-ink-2 hover:text-app transition-colors"
                    >
                      <FilmIcon size={11} /> <span className="truncate">{e.movie.title}</span>
                      <span className="ml-auto text-ink-3">→</span>
                    </Link>
                  ) : (
                    <span className="flex-1 px-2 py-1.5 text-[11px] text-ink-3">영화 연결 없음</span>
                  )}
                  {e.sourceUrl && (
                    <a
                      href={e.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-none border-l border-line-soft px-2 py-1.5 text-[10px] font-semibold text-ink-3 hover:text-app"
                      title={`원문 · ${checkedAgo(e.lastCheckedAt)}`}
                    >
                      출처 ↗
                    </a>
                  )}
                  <button
                    onClick={() => hide(e)}
                    className="flex-none px-2 py-1.5 text-[11px] text-ink-3 hover:text-soldout transition-colors"
                    title={e.movie ? "이 영화 숨기기" : "이 이벤트 숨기기"}
                  >
                    ✕
                  </button>
                </div>
                <p className="border-t border-line-soft px-2 py-1 text-[10px] text-ink-3">{checkedAgo(e.lastCheckedAt)}</p>
              </div>
            );
          })}
        </div>
      )}

      {peek && <EventPeek target={peek} onClose={() => setPeek(null)} />}
      <AppNav active="events" date={navDate} />
    </main>
  );
}
