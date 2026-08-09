"use client";

import { useState } from "react";
import Link from "next/link";
import type { Coverage, Chain } from "@mock/types";

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

// DB에 존재하는 마지막 상영일(coverage.maxDate)까지 날짜 칩을 그린다 — 하드코딩 금지.
// 폴백 8일(로딩 중·값 없음), 상한 21일(연도 오파싱 등 이상값 방어). 스트립은 가로 스크롤.
function buildDates(maxDate?: string | null) {
  const today = new Date();
  let count = 8;
  if (maxDate && /^\d{4}-\d{2}-\d{2}$/.test(maxDate)) {
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diff = Math.round((new Date(maxDate + "T00:00:00").getTime() - todayMidnight.getTime()) / 86_400_000) + 1;
    count = Math.min(Math.max(diff, 1), 21);
  }
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dayName = DAY_NAMES[d.getDay()];
    const label = i === 0 ? `오늘 ${dayName}` : dayName;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return { label, day: String(d.getDate()), dateStr: `${yyyy}-${mm}-${dd}` };
  });
}

const CHAINS: { key: Chain; label: string; color: string }[] = [
  { key: "CGV", label: "CGV", color: "var(--color-cgv)" },
  { key: "LOTTE", label: "롯데", color: "var(--color-lotte)" },
  { key: "MEGA", label: "메가", color: "var(--color-mega)" },
  { key: "INDIE", label: "독립", color: "#555" },
];

export interface TheaterInfo {
  id: number;
  chain: string;
  branchName: string;
  area: string;
  /** 선택 날짜에 상영이 있는지 — false면 그 날 쉬는 극장 (필터에 '쉼' 표시) */
  openToday?: boolean;
}

interface MovieMini {
  id: number;
  title: string;
  posterUrl: string | null;
}

interface CoverageWithTheaters extends Coverage {
  theaters?: TheaterInfo[];
  /** DB에 존재하는 마지막 상영일 (YYYY-MM-DD) — 날짜 스트립 범위 */
  maxDate?: string | null;
}

interface Props {
  queryBar?: React.ReactNode;
  coverage: CoverageWithTheaters;
  updatedAt: string;
  goodsUpdatedAt: string;
  view: "movie" | "time";
  onViewChange: (v: "movie" | "time") => void;
  selectedDate: string;
  onDateChange: (date: string) => void;
  afterNow: boolean;
  onAfterNowChange: (v: boolean) => void;
  goodieOnly: boolean;
  onGoodieOnlyChange: (v: boolean) => void;
  isToday: boolean;
  excludedTheaters: Set<number>;
  onToggleTheater: (id: number) => void;
  onToggleArea: (area: string) => void;
  excludedChains: Set<Chain>;
  onToggleChain: (chain: Chain) => void;
  movies: MovieMini[];
  excludedMovies: Set<number>;
  onToggleMovie: (id: number) => void;
  onResetMovies: () => void;
  onExcludeAllMovies: () => void;
  hasTheaterFilter: boolean;
  hasMovieFilter: boolean;
  onResetTheaters: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}

const CHAIN_COLORS: Record<string, string> = {
  CGV: "var(--color-cgv)",
  LOTTE: "var(--color-lotte)",
  MEGA: "var(--color-mega)",
  INDIE: "#555",
};

export default function HomeHeader({
  queryBar,
  coverage, updatedAt, goodsUpdatedAt, view, onViewChange, selectedDate, onDateChange,
  afterNow, onAfterNowChange, goodieOnly, onGoodieOnlyChange, isToday,
  excludedTheaters, onToggleTheater, onToggleArea,
  excludedChains, onToggleChain,
  movies, excludedMovies, onToggleMovie, onResetMovies, onExcludeAllMovies,
  hasTheaterFilter, hasMovieFilter, onResetTheaters,
  onRefresh, refreshing,
}: Props) {
  const [showTheaters, setShowTheaters] = useState(false);
  const [showMovies, setShowMovies] = useState(false);
  const updated = new Date(updatedAt);
  const goodsUpdated = new Date(goodsUpdatedAt);

  function ago(d: Date) {
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 60) return `${mins}분 전`;
    return `${Math.round(mins / 60)}시간 전`;
  }
  function hhmm(d: Date) {
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }

  const dates = buildDates(coverage.maxDate);

  // 지역별 그룹핑
  const theatersByArea = new Map<string, TheaterInfo[]>();
  for (const t of coverage.theaters ?? []) {
    if (!theatersByArea.has(t.area)) theatersByArea.set(t.area, []);
    theatersByArea.get(t.area)!.push(t);
  }

  const activeCount = (coverage.theaters ?? []).filter((t) => !excludedTheaters.has(t.id)).length;

  return (
    <div className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur-sm px-4 pt-3.5 pb-2.5">
      {/* 0행: 쿼리 한 줄 */}
      {queryBar && <div className="mb-2.5">{queryBar}</div>}

      {/* 1행: 제목 + 신선도 */}
      <div className="flex items-start gap-2">
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">지금 상영 시간표</h1>
          <button
            onClick={() => { setShowTheaters((v) => !v); setShowMovies(false); }}
            className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2 hover:text-app transition-colors"
          >
            <span className="text-app">◉</span>
            {coverage.label} · {activeCount}개 지점
            <span className={`text-[10px] transition-transform ${showTheaters ? "rotate-180" : ""}`}>▼</span>
          </button>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="ml-auto text-right text-[10.5px] leading-snug text-ink-3 whitespace-nowrap hover:text-app transition-colors disabled:opacity-50"
        >
          <span className={refreshing ? "inline-block animate-spin" : ""}>↻</span>
          {" "}상영 {hhmm(updated)} · {ago(updated)}
          <br />
          🎁 굿즈 {hhmm(goodsUpdated)} · {ago(goodsUpdated)}
        </button>
      </div>

      {/* 극장 목록 (지역별 그룹 + 체크박스) */}
      {showTheaters && theatersByArea.size > 0 && (
        <div className="mt-2 rounded-xl border border-line bg-ground/60 p-3 space-y-3">
          {[...theatersByArea.entries()].map(([area, list]) => {
            const allChecked = list.every((t) => !excludedTheaters.has(t.id));
            const noneChecked = list.every((t) => excludedTheaters.has(t.id));

            return (
              <div key={area}>
                <button
                  onClick={() => onToggleArea(area)}
                  className="mb-1.5 flex items-center gap-2 text-[12px] font-bold text-ink-2 hover:text-app transition-colors"
                >
                  <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px] ${
                    allChecked
                      ? "border-app bg-app text-white"
                      : noneChecked
                        ? "border-ink-3 bg-panel"
                        : "border-app bg-app-tint text-app"
                  }`}>
                    {allChecked ? "✓" : noneChecked ? "" : "−"}
                  </span>
                  {area}
                  <span className="font-normal text-ink-3">({list.filter((t) => !excludedTheaters.has(t.id)).length}/{list.length})</span>
                </button>
                <div className="flex flex-wrap gap-1.5 pl-1">
                  {list.map((t) => {
                    const active = !excludedTheaters.has(t.id);
                    const closed = t.openToday === false; // 그 날 쉬는 극장
                    return (
                      <button
                        key={t.id}
                        onClick={() => onToggleTheater(t.id)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11.5px] transition-colors ${
                          closed
                            ? "border-line-soft bg-ground text-ink-3 opacity-60"
                            : active
                              ? "border-line bg-panel text-ink-2"
                              : "border-line-soft bg-ground text-ink-3 line-through opacity-50"
                        }`}
                      >
                        <span
                          className="h-[6px] w-[6px] rounded-full flex-none"
                          style={{ background: active && !closed ? (CHAIN_COLORS[t.chain] ?? "#999") : "#ccc" }}
                        />
                        {t.branchName}
                        {closed && <span className="ml-0.5 text-[9.5px] text-ink-3">· 쉼</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 영화 골라보기 패널 */}
      {showMovies && movies.length > 0 && (
        <div className="mt-2 rounded-xl border border-line bg-ground/60 p-3">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="text-[12px] font-bold text-ink-2">
              영화 ({movies.length - excludedMovies.size}/{movies.length})
            </span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={onResetMovies}
                className="text-[11px] font-semibold text-app hover:underline"
              >
                전체 선택
              </button>
              <button
                onClick={onExcludeAllMovies}
                className="text-[11px] font-semibold text-ink-3 hover:underline"
              >
                전체 해제
              </button>
            </div>
          </div>
          <div className="overflow-x-auto scrollbar-none">
            <div className="grid grid-rows-2 grid-flow-col gap-x-2 gap-y-2 pb-1" style={{ gridAutoColumns: "60px" }}>
              {movies.map((m) => {
                const active = !excludedMovies.has(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => onToggleMovie(m.id)}
                    className="flex flex-col items-center gap-1 w-[60px] transition-all"
                  >
                    <div className="relative">
                      {m.posterUrl ? (
                        <img
                          src={m.posterUrl.replace("/w500/", "/w200/")}
                          alt=""
                          className={`h-[72px] w-[50px] rounded-lg object-cover shadow-sm transition-all ${
                            active ? "ring-2 ring-app" : "opacity-60"
                          }`}
                        />
                      ) : (
                        <div className={`flex h-[72px] w-[50px] items-center justify-center rounded-lg bg-[repeating-linear-gradient(135deg,#e7ebf0,#e7ebf0_6px,#eef1f5_6px,#eef1f5_12px)] text-lg text-[#aab1bb] shadow-sm transition-all ${
                          active ? "ring-2 ring-app" : "opacity-60"
                        }`}>
                          🎞️
                        </div>
                      )}
                      {active ? (
                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-app text-[9px] text-white shadow">
                          ✓
                        </span>
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white/80 text-[10px] text-white/80">✕</span>
                        </span>
                      )}
                    </div>
                    <span className={`w-full text-center text-[10px] leading-tight truncate ${
                      active ? "text-ink font-semibold" : "text-ink-3"
                    }`}>
                      {m.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 날짜 스트립 */}
      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
        {dates.map((d) => {
          const active = d.dateStr === selectedDate;
          return (
            <button
              key={d.dateStr}
              onClick={() => onDateChange(d.dateStr)}
              className={`flex-none rounded-xl border px-2.5 py-1.5 text-center ${
                active
                  ? "border-ink bg-ink text-white"
                  : "border-line bg-panel text-ink"
              }`}
            >
              <small className={`block text-[10px] ${active ? "text-white/70" : "text-ink-3"}`}>
                {d.label}
              </small>
              <b className="text-[15px]">{d.day}</b>
            </button>
          );
        })}
      </div>

      {/* 뷰 토글 + 지금 이후 */}
      <div className="mt-2.5 flex items-center gap-2">
        <div className="inline-flex rounded-[10px] bg-[#e7ebf1] p-0.5">
          <button
            onClick={() => onViewChange("movie")}
            className={`rounded-lg px-3 py-1 text-[12.5px] font-bold ${
              view === "movie"
                ? "bg-white text-ink shadow-sm"
                : "text-ink-2"
            }`}
          >
            영화별
          </button>
          <button
            onClick={() => onViewChange("time")}
            className={`rounded-lg px-3 py-1 text-[12.5px] font-bold ${
              view === "time"
                ? "bg-white text-ink shadow-sm"
                : "text-ink-2"
            }`}
          >
            시간순
          </button>
        </div>
        <Link
          href="/events"
          className="inline-flex items-center gap-1 rounded-full border border-goodie-line bg-goodie-tint/60 px-2.5 py-1 text-xs font-semibold text-goodie transition-colors hover:bg-goodie-tint"
        >
          🎁 특전 피드
        </Link>
        <button
          onClick={() => onAfterNowChange(!afterNow)}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
            afterNow && isToday
              ? "border-app bg-app-tint text-app"
              : "border-line bg-panel text-ink-3"
          }`}
        >
          🕒 지금 이후
        </button>
      </div>

      {/* 체인 필터 + 영화 골라보기 */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {CHAINS.map((c) => {
          const active = !excludedChains.has(c.key);
          return (
            <button
              key={c.key}
              onClick={() => onToggleChain(c.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold transition-colors ${
                active
                  ? "border-app bg-app-tint text-app"
                  : "border-line bg-panel text-ink-3 opacity-50"
              }`}
            >
              <span
                className="h-[7px] w-[7px] rounded-full"
                style={{ background: active ? c.color : "#ccc" }}
              />
              {c.label}
            </button>
          );
        })}
        <button
          onClick={() => onGoodieOnlyChange(!goodieOnly)}
          className={`rounded-full border px-2.5 py-1 text-[12.5px] font-semibold transition-colors ${
            goodieOnly
              ? "border-goodie bg-goodie-tint text-goodie"
              : "border-line bg-panel text-ink-2"
          }`}
        >
          🎁 특전만
        </button>
        <button
          onClick={() => { setShowMovies((v) => !v); setShowTheaters(false); }}
          className={`rounded-full border px-2.5 py-1 text-[12.5px] transition-colors ${
            showMovies || excludedMovies.size > 0
              ? "border-app bg-app-tint text-app font-semibold"
              : "border-line bg-panel text-ink-2"
          }`}
        >
          🎬 영화 골라보기
          {excludedMovies.size > 0 && (
            <span className="ml-1 text-[10px]">−{excludedMovies.size}</span>
          )}
        </button>
      </div>

      {/* 활성 필터 초기화 바 */}
      {(hasTheaterFilter || hasMovieFilter) && (
        <div className="mt-2 flex items-center gap-2 text-[11.5px]">
          <span className="text-ink-3">필터 적용 중:</span>
          {hasTheaterFilter && (
            <button
              onClick={onResetTheaters}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 text-ink-2 hover:border-soldout hover:text-soldout transition-colors"
            >
              극장별 <span className="text-[10px]">✕</span>
            </button>
          )}
          {hasMovieFilter && (
            <button
              onClick={onResetMovies}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 text-ink-2 hover:border-soldout hover:text-soldout transition-colors"
            >
              영화별 <span className="text-[10px]">✕</span>
            </button>
          )}
          {hasTheaterFilter && hasMovieFilter && (
            <button
              onClick={() => { onResetTheaters(); onResetMovies(); }}
              className="ml-auto text-ink-3 hover:text-soldout transition-colors"
            >
              전체 초기화
            </button>
          )}
        </div>
      )}
    </div>
  );
}
