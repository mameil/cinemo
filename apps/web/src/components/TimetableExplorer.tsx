"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ScreeningCard, Chain, EventPreview, GoodieStockLite } from "@mock/types";
import HomeHeader, { type DateCoverage, type TheaterInfo } from "@/components/HomeHeader";
import MovieGroupView from "@/components/MovieGroupView";
import TimelineView from "@/components/TimelineView";
import QueryBar, { type QueryChip } from "@/components/QueryBar";
import { parseQuery } from "@/lib/query-parse";
import { saveFilters, loadFilters } from "@/lib/filter-store";
import AppNav from "@/components/AppNav";

interface MovieMiniResponse {
  id: number;
  title: string;
  posterUrl: string | null;
}

interface HomeTimetableResponse {
  date: string;
  coverage: {
    label: string;
    theaterCount: number;
    theaters?: TheaterInfo[];
    maxDate?: string | null;
    dateCoverage?: DateCoverage[];
  };
  updatedAt: string;
  goodsUpdatedAt: string;
  movies: MovieMiniResponse[];
  screenings: ScreeningCard[];
  eventPreviews: Record<string, EventPreview[]>;
  goodieStock: Record<string, GoodieStockLite[]>;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function normTitle(s: string) {
  return s.toLowerCase().replace(/\s+/g, "");
}

export default function TimetableExplorer({ defaultView = "movie" }: { defaultView?: "movie" | "time" }) {
  const router = useRouter();
  const [initialized, setInitialized] = useState(false);
  const [view, setView] = useState<"movie" | "time">(defaultView);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [data, setData] = useState<HomeTimetableResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryTick, setRetryTick] = useState(0); // 다시 시도 트리거
  const [afterNow, setAfterNow] = useState(true);
  const [goodieOnly, setGoodieOnly] = useState(false);
  const [excludedTheaters, setExcludedTheaters] = useState<Set<number>>(new Set());
  const [excludedChains, setExcludedChains] = useState<Set<Chain>>(new Set());
  const [excludedMovies, setExcludedMovies] = useState<Set<number>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [directTheaterId, setDirectTheaterId] = useState<number | null>(null);
  const [initialShowTheaters, setInitialShowTheaters] = useState(false);

  // 쿼리 필터 (한 줄 검색 → 시간/장소/영화 레이어, 수동 필터와 별개)
  const [queryMovie, setQueryMovie] = useState<string | null>(null);
  const [queryLocation, setQueryLocation] = useState<string | null>(null);
  const [queryTime, setQueryTime] = useState<{ from: string | null; to: string | null; label: string } | null>(null);
  const [queryDateLabel, setQueryDateLabel] = useState<string | null>(null);

  // 복원 (마운트 시 1회)
  useEffect(() => {
    const saved = loadFilters();
    const params = new URLSearchParams(window.location.search);
    const requestedDate = params.get("date");
    const requestedView = params.get("view");
    const requestedQuery = params.get("query");
    const requestedTheater = Number(params.get("theater"));
    setInitialShowTheaters(params.get("open") === "theaters");
    if (saved) {
      setView(requestedView === "time" || defaultView === "time" ? "time" : saved.view);
      // 지난 날짜가 복원되면 오늘로 클램프 — 어제 보던 탭을 오늘 열면
      // 과거 날짜가 선택돼 "지금 이후"가 무력화되고 지난 회차가 그대로 보이던 버그
      setSelectedDate(requestedDate && requestedDate >= todayStr() ? requestedDate : saved.selectedDate >= todayStr() ? saved.selectedDate : todayStr());
      setAfterNow(saved.afterNow);
      setGoodieOnly(saved.goodieOnly ?? false);
      setExcludedTheaters(new Set(saved.excludedTheaters));
      setExcludedChains(new Set(saved.excludedChains));
      setExcludedMovies(new Set(saved.excludedMovies));
    } else {
      if (requestedDate && requestedDate >= todayStr()) setSelectedDate(requestedDate);
      if (requestedView === "time" || defaultView === "time") setView("time");
    }
    if (requestedQuery) setQueryMovie(requestedQuery);
    if (Number.isInteger(requestedTheater) && requestedTheater > 0) {
      setDirectTheaterId(requestedTheater);
      // 극장 화면에서 한 곳을 명시해 들어온 경우 과거에 저장한 숨김 필터보다
      // 직접 선택을 우선한다. 그렇지 않으면 선택한 극장이 빈 화면으로 보일 수 있다.
      setExcludedTheaters(new Set());
      setExcludedChains(new Set());
      setExcludedMovies(new Set());
    }
    setInitialized(true);
  }, [defaultView]);

  // 저장 (필터 변경 시)
  useEffect(() => {
    if (!initialized) return;
    saveFilters({
      view,
      selectedDate,
      afterNow,
      goodieOnly,
      excludedTheaters: [...excludedTheaters],
      excludedChains: [...excludedChains],
      excludedMovies: [...excludedMovies],
    });
  }, [initialized, view, selectedDate, afterNow, goodieOnly, excludedTheaters, excludedChains, excludedMovies]);

  // 데이터 로드
  useEffect(() => {
    if (!initialized) return;
    setLoading(true);
    setLoadError(false);
    fetch(`/api/screenings?date=${selectedDate}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setData(d))
      .catch(() => setLoadError(true)) // DB 순간 장애 등 — 에러 상태로 전환
      .finally(() => setLoading(false));
  }, [selectedDate, initialized, retryTick]);

  const isToday = selectedDate === todayStr();

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetch(`/api/screenings?date=${selectedDate}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setRefreshing(false));
  }, [selectedDate]);

  const handleToggleTheater = useCallback((id: number) => {
    setExcludedTheaters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleArea = useCallback((area: string) => {
    if (!data?.coverage.theaters) return;
    const areaTheaters = data.coverage.theaters.filter((t) => t.area === area);
    const allActive = areaTheaters.every((t) => !excludedTheaters.has(t.id));
    setExcludedTheaters((prev) => {
      const next = new Set(prev);
      for (const t of areaTheaters) {
        if (allActive) next.add(t.id);
        else next.delete(t.id);
      }
      return next;
    });
  }, [data, excludedTheaters]);

  const handleToggleChain = useCallback((chain: Chain) => {
    setExcludedChains((prev) => {
      const next = new Set(prev);
      if (next.has(chain)) next.delete(chain);
      else next.add(chain);
      return next;
    });
  }, []);

  const handleToggleMovie = useCallback((movieId: number) => {
    setExcludedMovies((prev) => {
      const next = new Set(prev);
      if (next.has(movieId)) next.delete(movieId);
      else next.add(movieId);
      return next;
    });
  }, []);

  const handleResetMovies = useCallback(() => {
    setExcludedMovies(new Set());
  }, []);

  const handleResetTheaters = useCallback(() => {
    setExcludedTheaters(new Set());
    setExcludedChains(new Set());
  }, []);

  // ── 쿼리 한 줄 처리 ──

  const handleQuerySubmit = useCallback((raw: string) => {
    const parsed = parseQuery(raw, data?.coverage.theaters ?? []);
    if (parsed.date) {
      setSelectedDate(parsed.date);
      setQueryDateLabel(parsed.dateLabel);
    }
    if (parsed.timeFrom || parsed.timeTo) {
      setQueryTime({ from: parsed.timeFrom, to: parsed.timeTo, label: parsed.timeLabel! });
    }
    if (parsed.location) setQueryLocation(parsed.location);
    if (parsed.movieText) setQueryMovie(parsed.movieText);
  }, [data]);

  const handleRemoveQueryChip = useCallback((key: string) => {
    if (key === "movie") setQueryMovie(null);
    else if (key === "location") setQueryLocation(null);
    else if (key === "time") setQueryTime(null);
    else if (key === "date") {
      setQueryDateLabel(null);
      setSelectedDate(todayStr());
    }
  }, []);

  const handleClearQuery = useCallback(() => {
    setQueryMovie(null);
    setQueryLocation(null);
    setQueryTime(null);
    if (queryDateLabel) {
      setQueryDateLabel(null);
      setSelectedDate(todayStr());
    }
  }, [queryDateLabel]);

  // 날짜를 스트립에서 직접 바꾸면 쿼리 날짜 칩은 해제
  const handleDateChange = useCallback((date: string) => {
    setSelectedDate(date);
    setQueryDateLabel(null);
  }, []);

  const handleViewChange = useCallback((nextView: "movie" | "time") => {
    setView(nextView);
    router.push(`${nextView === "time" ? "/timeline" : "/movies"}?date=${selectedDate}`);
  }, [router, selectedDate]);

  // 쿼리 장소 → 극장 id 집합
  const queryTheaterIds = useMemo(() => {
    if (directTheaterId) return new Set([directTheaterId]);
    if (!queryLocation || !data?.coverage.theaters) return null;
    return new Set(
      data.coverage.theaters
        .filter((t) => t.branchName.includes(queryLocation) || t.area.includes(queryLocation))
        .map((t) => t.id)
    );
  }, [queryLocation, data, directTheaterId]);

  // 쿼리 영화 → 영화 id 집합 (해당 날짜 상영 영화와 대조)
  const queryMovieIds = useMemo(() => {
    if (!queryMovie || !data) return null;
    const q = normTitle(queryMovie);
    return new Set(
      data.movies
        .filter((m) => {
          const t = normTitle(m.title);
          return t.includes(q) || q.includes(t);
        })
        .map((m) => m.id)
    );
  }, [queryMovie, data]);

  const queryChips: QueryChip[] = useMemo(() => {
    const chips: QueryChip[] = [];
    if (queryMovie) chips.push({ key: "movie", icon: "🎬", label: queryMovie });
    if (queryLocation) chips.push({ key: "location", icon: "📍", label: queryLocation });
    if (queryTime) chips.push({ key: "time", icon: "🕐", label: queryTime.label });
    if (queryDateLabel) chips.push({ key: "date", icon: "📅", label: queryDateLabel });
    return chips;
  }, [queryMovie, queryLocation, queryTime, queryDateLabel]);

  const queryHint =
    queryMovie && queryMovieIds && queryMovieIds.size === 0 && !loading
      ? `이날 "${queryMovie}" 상영을 찾지 못했어요`
      : null;

  const hasQueryFilter = queryChips.length > 0;

  // ── 필터 파이프라인 ──

  // 극장+체인+쿼리(장소·시간) 필터 (영화 목록 추출용)
  const theaterFiltered = useMemo(() => {
    if (!data) return [];
    let list = data.screenings;

    if (!directTheaterId && excludedTheaters.size > 0) {
      list = list.filter((s) => !excludedTheaters.has(s.theater.id));
    }
    if (excludedChains.size > 0) {
      list = list.filter((s) => !excludedChains.has(s.theater.chain));
    }
    if (queryTheaterIds) {
      list = list.filter((s) => queryTheaterIds.has(s.theater.id));
    }
    if (queryTime?.from) {
      list = list.filter((s) => s.startTime >= queryTime.from!);
    }
    if (queryTime?.to) {
      list = list.filter((s) => s.startTime <= queryTime.to!);
    }
    if (afterNow && isToday) {
      const now = nowHHMM();
      list = list.filter((s) => s.startTime >= now);
    }
    // 특전 받는 상영만 (포맷 조건까지 통과한 회차 기준)
    if (goodieOnly) {
      list = list.filter((s) => s.hasEvent && s.eventTypes.length > 0);
    }

    return list;
  }, [data, directTheaterId, excludedTheaters, excludedChains, queryTheaterIds, queryTime, afterNow, isToday, goodieOnly]);

  // 선택된 극장에서 실제 상영 중인 영화만
  const availableMovies = useMemo(() => {
    const seen = new Set<number>();
    const result: MovieMiniResponse[] = [];
    for (const s of theaterFiltered) {
      if (!seen.has(s.movie.id)) {
        seen.add(s.movie.id);
        result.push(s.movie);
      }
    }
    return result;
  }, [theaterFiltered]);

  const handleExcludeAllMovies = useCallback(() => {
    setExcludedMovies(new Set(availableMovies.map((m) => m.id)));
  }, [availableMovies]);

  // 최종 필터 (영화 수동 제외 + 쿼리 영화)
  const filtered = useMemo(() => {
    let list = theaterFiltered;

    if (excludedMovies.size > 0) {
      list = list.filter((s) => !excludedMovies.has(s.movie.id));
    }
    if (queryMovieIds) {
      list = list.filter((s) => queryMovieIds.has(s.movie.id));
    }

    return list;
  }, [theaterFiltered, excludedMovies, queryMovieIds]);

  const hasTheaterFilter = excludedTheaters.size > 0 || excludedChains.size > 0;
  const hasMovieFilter = excludedMovies.size > 0;

  return (
    <div className="mx-auto max-w-[980px]">
      <HomeHeader
        queryBar={
          <QueryBar
            chips={queryChips}
            hint={queryHint}
            onSubmit={handleQuerySubmit}
            onRemoveChip={handleRemoveQueryChip}
            onClearAll={handleClearQuery}
          />
        }
        coverage={data?.coverage ?? { label: "로딩 중…", theaterCount: 0 }}
        updatedAt={data?.updatedAt ?? new Date().toISOString()}
        goodsUpdatedAt={data?.goodsUpdatedAt ?? new Date().toISOString()}
        view={view}
        onViewChange={handleViewChange}
        selectedDate={selectedDate}
        onDateChange={handleDateChange}
        afterNow={afterNow}
        onAfterNowChange={setAfterNow}
        goodieOnly={goodieOnly}
        onGoodieOnlyChange={setGoodieOnly}
        isToday={isToday}
        excludedTheaters={excludedTheaters}
        onToggleTheater={handleToggleTheater}
        onToggleArea={handleToggleArea}
        excludedChains={excludedChains}
        onToggleChain={handleToggleChain}
        movies={availableMovies}
        excludedMovies={excludedMovies}
        onToggleMovie={handleToggleMovie}
        onResetMovies={handleResetMovies}
        onExcludeAllMovies={handleExcludeAllMovies}
        hasTheaterFilter={hasTheaterFilter}
        hasMovieFilter={hasMovieFilter}
        onResetTheaters={handleResetTheaters}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        initialShowTheaters={initialShowTheaters}
      />

      {loading ? (
        <div className="py-20 text-center text-sm text-ink-3">불러오는 중…</div>
      ) : loadError ? (
        <div className="py-20 text-center text-sm text-ink-3">
          데이터를 불러오지 못했어요 (일시적인 문제일 수 있어요)
          <br />
          <button
            onClick={() => setRetryTick((t) => t + 1)}
            className="mt-3 rounded-full border border-line bg-panel px-4 py-1.5 text-xs font-semibold text-ink-2 hover:border-app hover:text-app transition-colors"
          >
            ↻ 다시 시도
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-sm text-ink-3">
          {hasQueryFilter ? (
            <>
              조건에 맞는 상영이 없어요
              <br />
              <button
                onClick={handleClearQuery}
                className="mt-3 rounded-full border border-line bg-panel px-3 py-1 text-xs font-semibold text-ink-2 hover:border-app hover:text-app transition-colors"
              >
                검색 조건 지우기
              </button>
            </>
          ) : goodieOnly ? (
            <>
              특전 받는 상영이 없어요
              <br />
              <button
                onClick={() => setGoodieOnly(false)}
                className="mt-3 rounded-full border border-line bg-panel px-3 py-1 text-xs font-semibold text-ink-2 hover:border-goodie hover:text-goodie transition-colors"
              >
                🎁 특전만 해제
              </button>
            </>
          ) : afterNow && isToday ? (
            "지금 이후 상영이 없습니다"
          ) : (
            `${selectedDate} 상영 데이터가 없습니다`
          )}
        </div>
      ) : view === "movie" ? (
        <MovieGroupView
          screenings={filtered}
          eventPreviews={data?.eventPreviews}
          goodieStock={data?.goodieStock}
          onExcludeMovie={handleToggleMovie}
        />
      ) : (
        <TimelineView screenings={filtered} eventPreviews={data?.eventPreviews} />
      )}

      {/* 최근 배포 정보 — 빌드 시점에 구워짐 */}
      <footer className="py-6 text-center text-[10.5px] text-ink-3">
        최근 배포 {formatBuildAt(process.env.NEXT_PUBLIC_BUILD_AT)} · {process.env.NEXT_PUBLIC_COMMIT}
      </footer>
      <AppNav
        active={initialShowTheaters ? "theaters" : view === "time" ? "timeline" : "movies"}
        date={selectedDate}
      />
    </div>
  );
}

/** 빌드 ISO 시각 → KST "M/D HH:mm" (서버/클라 동일 결과 — 하이드레이션 안전) */
function formatBuildAt(iso?: string): string {
  if (!iso) return "-";
  const kst = new Date(new Date(iso).getTime() + 9 * 3600e3);
  return `${kst.getUTCMonth() + 1}/${kst.getUTCDate()} ${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}
