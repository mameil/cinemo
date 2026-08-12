"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Coverage, Chain } from "@mock/types";
import { localDateString, type DateCoverage } from "@/lib/dates";
import DateStrip from "@/components/DateStrip";
import { GiftIcon, RefreshIcon, SlidersIcon, ClockIcon, FilmIcon, HomeIcon, CheckIcon, XIcon } from "@/components/icons";

export type { DateCoverage } from "@/lib/dates";

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
  /** 선택 날짜에 상영이 있는지 */
  openToday?: boolean;
  /** open=상영 있음, closed=공개된 일정 범위 안의 빈 날, uncollected=아직 일정 범위 밖 */
  scheduleStatus?: "open" | "closed" | "uncollected";
  /** 이 극장의 시간표를 마지막으로 수집·갱신한 시각 */
  updatedAt?: string | null;
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
  /** 날짜별로 실제 상영정보가 등록된 범위 */
  dateCoverage?: DateCoverage[];
}

interface Props {
  queryBar?: React.ReactNode;
  coverage: CoverageWithTheaters;
  /** null = 아직 로딩 전 — 시각을 지어내지 않고 플레이스홀더를 보여준다 */
  updatedAt: string | null;
  goodsUpdatedAt: string | null;
  /** 데이터 도착 전 여부 — 날짜 칩이 "일정 없음"으로 오인되지 않게 */
  loading?: boolean;
  goodsUpdatedBySource?: Partial<Record<Chain, string>>;
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
  initialShowTheaters?: boolean;
}

const CHAIN_COLORS: Record<string, string> = {
  CGV: "var(--color-cgv)",
  LOTTE: "var(--color-lotte)",
  MEGA: "var(--color-mega)",
  INDIE: "#555",
};

export default function HomeHeader({
  queryBar,
  coverage, updatedAt, goodsUpdatedAt, goodsUpdatedBySource, loading = false, view, onViewChange, selectedDate, onDateChange,
  afterNow, onAfterNowChange, goodieOnly, onGoodieOnlyChange, isToday,
  excludedTheaters, onToggleTheater, onToggleArea,
  excludedChains, onToggleChain,
  movies, excludedMovies, onToggleMovie, onResetMovies, onExcludeAllMovies,
  hasTheaterFilter, hasMovieFilter, onResetTheaters,
  onRefresh, refreshing,
  initialShowTheaters = false,
}: Props) {
  const [showTheaters, setShowTheaters] = useState(initialShowTheaters);
  const [showMovies, setShowMovies] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const mobileSheetRef = useRef<HTMLElement | null>(null);
  const goodsSourceLabels: Record<Chain, string> = { CGV: "CGV", LOTTE: "롯데", MEGA: "메가", INDIE: "독립" };
  const goodsSourceSummary = CHAINS
    .filter(({ key }) => goodsUpdatedBySource?.[key])
    .map(({ key }) => `${goodsSourceLabels[key]} ${ago(new Date(goodsUpdatedBySource![key]!))}`)
    .join(" · ");

  function ago(d: Date) {
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 60) return `${mins}분 전`;
    return `${Math.round(mins / 60)}시간 전`;
  }
  function hhmm(d: Date) {
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }
  /** 갱신 시각 표시 — 로딩 전(null)엔 시각을 지어내지 않는다 */
  function freshness(iso: string | null) {
    if (!iso) return "· · ·";
    const d = new Date(iso);
    return `${hhmm(d)} · ${ago(d)}`;
  }

  const coverageByDate = new Map((coverage.dateCoverage ?? []).map((item) => [item.date, item]));
  const selectedCoverage = coverageByDate.get(selectedDate);
  const todayDate = localDateString();
  // 당일 휴관은 정상일 수 있으므로 경고하지 않는다. 미래 날짜가 전체 카탈로그의
  // 70% 미만일 때만 아직 일부 극장 일정만 열린 것으로 안내한다.
  const partialThreshold = Math.ceil(coverage.theaterCount * 0.7);
  const isPartialCoverage = Boolean(
    selectedCoverage &&
    selectedDate > todayDate &&
    selectedCoverage.theaterCount < partialThreshold
  );

  // 지역별 그룹핑
  const theatersByArea = new Map<string, TheaterInfo[]>();
  for (const t of coverage.theaters ?? []) {
    if (!theatersByArea.has(t.area)) theatersByArea.set(t.area, []);
    theatersByArea.get(t.area)!.push(t);
  }

  const activeCount = (coverage.theaters ?? []).filter((t) => !excludedTheaters.has(t.id)).length;
  const activeMovieCount = movies.filter((movie) => !excludedMovies.has(movie.id)).length;
  const filterCount = Number(excludedChains.size > 0)
    + Number(hasTheaterFilter)
    + Number(hasMovieFilter)
    + Number(goodieOnly)
    + Number(view !== "time" && isToday && afterNow);

  useEffect(() => {
    if (!showMobileFilters) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // 시트가 열리면 포커스를 시트로 옮긴다 — 스크린리더가 뒤 컨텐츠로 새지 않게
    mobileSheetRef.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowMobileFilters(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
    };
  }, [showMobileFilters]);

  return (
    <div className="sticky top-0 z-10 border-b border-line bg-white/95 px-4 pt-3.5 pb-2.5">
      {/* 0행: 쿼리 한 줄 */}
      {queryBar && <div className="mb-2.5">{queryBar}</div>}

      {/* 1행: 제목 + 신선도 */}
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-extrabold tracking-tight">지금 상영 시간표</h1>
          <button
            onClick={() => {
              setShowMovies(false);
              if (window.matchMedia("(max-width: 639px)").matches) {
                setShowTheaters(true);
                setShowMobileFilters(true);
              } else {
                setShowTheaters((value) => !value);
              }
            }}
            aria-expanded={showTheaters}
            className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-2 hover:text-app transition-colors"
          >
            <span className="inline-block h-[7px] w-[7px] flex-none rounded-full bg-app ring-[3px] ring-app/20" aria-hidden="true" />
            {coverage.label} · {activeCount}개 지점
            <span className={`text-[10px] transition-transform ${showTheaters ? "rotate-180" : ""}`}>▼</span>
          </button>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="max-w-[48%] flex-none text-right text-[10.5px] leading-snug text-ink-3 hover:text-app transition-colors disabled:opacity-50"
        >
          <RefreshIcon size={10} className={refreshing ? "animate-spin" : ""} />
          {" "}상영 {freshness(updatedAt)}
          <br />
          <GiftIcon size={10} /> {goodsSourceSummary || `굿즈 ${freshness(goodsUpdatedAt)}`}
        </button>
      </div>

      {/* 극장 목록 (지역별 그룹 + 체크박스) */}
      {showTheaters && theatersByArea.size > 0 && (
        <div className="mt-2 hidden rounded-xl border border-line bg-ground/60 p-3 space-y-3 sm:block">
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
                    const closed = t.openToday === false;
                    const emptyLabel = t.scheduleStatus === "closed" ? "쉼" : "일정 미등록";
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
                        {closed && <span className="ml-0.5 text-[9.5px] text-ink-3">· {emptyLabel}</span>}
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
        <div className="mt-2 hidden rounded-xl border border-line bg-ground/60 p-3 sm:block">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="text-[12px] font-bold text-ink-2">
              영화 ({activeMovieCount}/{movies.length})
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
                          alt={`${m.title} 포스터`}
                          className={`h-[72px] w-[50px] rounded-lg object-cover shadow-sm transition-all ${
                            active ? "ring-2 ring-app" : "opacity-60"
                          }`}
                        />
                      ) : (
                        <div className={`flex h-[72px] w-[50px] items-center justify-center rounded-lg bg-[repeating-linear-gradient(135deg,#e7ebf0,#e7ebf0_6px,#eef1f5_6px,#eef1f5_12px)] text-[#aab1bb] shadow-sm transition-all ${
                          active ? "ring-2 ring-app" : "opacity-60"
                        }`}>
                          <FilmIcon size={16} />
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
      <DateStrip
        selectedDate={selectedDate}
        onChange={onDateChange}
        maxDate={coverage.maxDate}
        dateCoverage={coverage.dateCoverage}
        loading={loading}
      />

      {isPartialCoverage && selectedCoverage && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          아직 일부 극장 일정만 등록됐어요 · {selectedCoverage.theaterCount}/{coverage.theaterCount}개 극장
        </div>
      )}

      {/* 뷰 토글 + 지금 이후 */}
      <div className="mt-2.5 flex items-center gap-2">
        <div className="inline-flex rounded-[10px] bg-[#e7ebf1] p-0.5">
          <button
            onClick={() => onViewChange("movie")}
            aria-pressed={view === "movie"}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1 text-[12.5px] font-bold ${
              view === "movie"
                ? "bg-white text-ink shadow-sm"
                : "text-ink-2"
            }`}
          >
            <CheckIcon size={11} className={view === "movie" ? "text-app" : "opacity-0"} />영화별
          </button>
          <button
            onClick={() => onViewChange("time")}
            aria-pressed={view === "time"}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1 text-[12.5px] font-bold ${
              view === "time"
                ? "bg-white text-ink shadow-sm"
                : "text-ink-2"
            }`}
          >
            <CheckIcon size={11} className={view === "time" ? "text-app" : "opacity-0"} />시간순
          </button>
        </div>
        <Link
          href={`/events?date=${selectedDate}`}
          className="inline-flex items-center gap-1 rounded-full border border-goodie-line bg-goodie-tint/60 px-2.5 py-1 text-xs font-semibold text-goodie transition-colors hover:bg-goodie-tint"
        >
          <GiftIcon size={12} /> 특전 피드
        </Link>
        <button
          onClick={() => setShowMobileFilters(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-3 py-1 text-xs font-bold text-ink-2 sm:hidden"
        >
          <SlidersIcon size={12} /> 필터{filterCount > 0 && <span className="rounded-full bg-app px-1.5 text-[9px] text-white">{filterCount}</span>}
        </button>
        {view !== "time" && (
          <button
            onClick={() => onAfterNowChange(!afterNow)}
            aria-pressed={afterNow && isToday}
            className={`ml-auto hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors sm:inline-flex ${
              afterNow && isToday
                ? "border-app bg-app-tint text-app"
                : "border-line bg-panel text-ink-3"
            }`}
          >
            {afterNow && isToday ? <CheckIcon size={12} /> : <ClockIcon size={12} />}지금 이후
          </button>
        )}
      </div>

      {/* 체인 필터 + 영화 골라보기 */}
      <div className="mt-2.5 hidden flex-wrap gap-1.5 sm:flex">
        {CHAINS.map((c) => {
          const active = !excludedChains.has(c.key);
          return (
          <button
            key={c.key}
            onClick={() => onToggleChain(c.key)}
            aria-pressed={active}
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
              <CheckIcon size={11} className={active ? "" : "opacity-0"} />{c.label}
            </button>
          );
        })}
        <button
          onClick={() => onGoodieOnlyChange(!goodieOnly)}
          aria-pressed={goodieOnly}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold transition-colors ${
            goodieOnly
              ? "border-goodie bg-goodie-tint text-goodie"
              : "border-line bg-panel text-ink-2"
          }`}
        >
          {goodieOnly ? <CheckIcon size={12} /> : <GiftIcon size={12} />}특전만
        </button>
        <button
          onClick={() => { setShowMovies((v) => !v); setShowTheaters(false); }}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12.5px] transition-colors ${
            showMovies || excludedMovies.size > 0
              ? "border-app bg-app-tint text-app font-semibold"
              : "border-line bg-panel text-ink-2"
          }`}
        >
          <FilmIcon size={12} /> 영화 골라보기
          {excludedMovies.size > 0 && (
            <span className="ml-1 text-[10px]">−{excludedMovies.size}</span>
          )}
        </button>
      </div>

      {/* 활성 필터 초기화 바 */}
      {(hasTheaterFilter || hasMovieFilter) && (
        <div className="mt-2 hidden items-center gap-2 text-[11.5px] sm:flex">
          <span className="text-ink-3">필터 적용 중:</span>
          {hasTheaterFilter && (
            <button
              onClick={onResetTheaters}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 text-ink-2 hover:border-soldout hover:text-soldout transition-colors"
            >
              극장별 <XIcon size={10} />
            </button>
          )}
          {hasMovieFilter && (
            <button
              onClick={onResetMovies}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 text-ink-2 hover:border-soldout hover:text-soldout transition-colors"
            >
              영화별 <XIcon size={10} />
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

      {showMobileFilters && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <button
            className="absolute inset-0 bg-black/35"
            onClick={() => setShowMobileFilters(false)}
            aria-label="필터 닫기"
          />
          <section
            ref={mobileSheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="상세 필터"
            tabIndex={-1}
            className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-3xl bg-white px-4 pb-7 pt-3 shadow-2xl outline-none"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line" />
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold">상세 필터</h2>
              {filterCount > 0 && <span className="rounded-full bg-app-tint px-2 py-0.5 text-[10px] font-bold text-app">{filterCount}개 적용</span>}
              <button onClick={() => setShowMobileFilters(false)} className="ml-auto rounded-full bg-ground px-3 py-1 text-xs font-bold text-ink-2">완료</button>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-bold text-ink-2">영화관 체인</p>
              <div className="flex flex-wrap gap-1.5">
                {CHAINS.map((chain) => {
                  const active = !excludedChains.has(chain.key);
                  return (
                    <button
                      key={chain.key}
                      onClick={() => onToggleChain(chain.key)}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? "border-app bg-app-tint text-app" : "border-line bg-ground text-ink-3 opacity-55"}`}
                    >
                      <CheckIcon size={11} className={active ? "" : "opacity-0"} />{chain.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => onGoodieOnlyChange(!goodieOnly)}
                aria-pressed={goodieOnly}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold ${goodieOnly ? "border-goodie bg-goodie-tint text-goodie" : "border-line bg-panel text-ink-2"}`}
              >
                {goodieOnly ? <CheckIcon size={12} /> : <GiftIcon size={12} />}특전만
              </button>
              {view !== "time" && isToday && (
                <button
                  onClick={() => onAfterNowChange(!afterNow)}
                  aria-pressed={afterNow}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold ${afterNow ? "border-app bg-app-tint text-app" : "border-line bg-panel text-ink-2"}`}
                >
                  {afterNow ? <CheckIcon size={12} /> : <ClockIcon size={12} />}지금 이후
                </button>
              )}
              <button
                onClick={() => { setShowTheaters((value) => !value); setShowMovies(false); }}
                aria-expanded={showTheaters}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold ${showTheaters || hasTheaterFilter ? "border-app bg-app-tint text-app" : "border-line"}`}
              >
                {showTheaters ? <CheckIcon size={12} /> : <HomeIcon size={12} />}극장 선택
              </button>
              <button
                onClick={() => { setShowMovies((value) => !value); setShowTheaters(false); }}
                aria-expanded={showMovies}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-bold ${showMovies || hasMovieFilter ? "border-app bg-app-tint text-app" : "border-line"}`}
              >
                {showMovies ? <CheckIcon size={12} /> : <FilmIcon size={12} />}영화 선택
              </button>
            </div>

            {showTheaters && (
              <div className="mt-4 space-y-4 rounded-2xl bg-ground p-3">
                {[...theatersByArea.entries()].map(([area, list]) => (
                  <div key={area}>
                    <button onClick={() => onToggleArea(area)} className="mb-2 text-xs font-extrabold text-ink-2">
                      {area} · {list.filter((theater) => !excludedTheaters.has(theater.id)).length}/{list.length}
                    </button>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((theater) => {
                        const active = !excludedTheaters.has(theater.id);
                        const emptyLabel = theater.scheduleStatus === "closed" ? "쉼" : "일정 미등록";
                        return (
                          <button
                            key={theater.id}
                            onClick={() => onToggleTheater(theater.id)}
                            aria-pressed={active}
                            className={`rounded-lg border px-2 py-1 text-[11px] ${active ? "border-line bg-white text-ink-2" : "border-line-soft text-ink-3 line-through opacity-50"}`}
                          >
                            {active && <span aria-hidden="true">✓ </span>}{theater.branchName}{theater.openToday === false && ` · ${emptyLabel}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showMovies && movies.length > 0 && (
              <div className="mt-4 rounded-2xl bg-ground p-3">
                <div className="mb-2 flex items-center text-xs font-bold">
                  영화 {activeMovieCount}/{movies.length}
                  <button onClick={onResetMovies} className="ml-auto text-app">전체 선택</button>
                  <button onClick={onExcludeAllMovies} className="ml-3 text-ink-3">전체 해제</button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {movies.map((movie) => {
                    const active = !excludedMovies.has(movie.id);
                    return (
                      <button key={movie.id} onClick={() => onToggleMovie(movie.id)} aria-pressed={active} className="w-[58px] flex-none">
                        {movie.posterUrl ? (
                          <img src={movie.posterUrl.replace("/w500/", "/w200/")} alt={`${movie.title} 포스터`} className={`h-[78px] w-[54px] rounded-lg object-cover ${active ? "ring-2 ring-app" : "opacity-45"}`} />
                        ) : <div className={`flex h-[78px] w-[54px] items-center justify-center rounded-lg bg-line-soft text-[#aab1bb] ${active ? "ring-2 ring-app" : "opacity-45"}`}><FilmIcon size={16} /></div>}
                        <span className="mt-1 block truncate text-[9.5px]">{active && <span aria-hidden="true">✓ </span>}{movie.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {filterCount > 0 && (
              <button
                onClick={() => {
                  onResetTheaters();
                  onResetMovies();
                  onGoodieOnlyChange(false);
                  if (afterNow) onAfterNowChange(false);
                }}
                className="mt-5 w-full rounded-xl border border-line py-2.5 text-sm font-bold text-soldout"
              >
                필터 전체 초기화
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
