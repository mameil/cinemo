"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ScreeningCard } from "@mock/types";
import type { DateCoverage, TheaterInfo } from "@/components/HomeHeader";
import AppNav from "@/components/AppNav";

interface TheaterResponse {
  coverage: {
    theaterCount: number;
    theaters?: TheaterInfo[];
    maxDate?: string | null;
    dateCoverage?: DateCoverage[];
  };
  screenings: ScreeningCard[];
}

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const FAVORITE_THEATERS_KEY = "cinemo-favorite-theaters";

type TheaterCard = TheaterInfo & {
  items: ScreeningCard[];
  next: string | null;
};

function dateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeString() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function datesUntil(maxDate?: string | null) {
  const today = new Date();
  const todayText = dateString(today);
  const last = maxDate && maxDate >= todayText ? new Date(`${maxDate}T00:00:00`) : null;
  const count = last
    ? Math.min(Math.max(Math.floor((last.getTime() - new Date(`${todayText}T00:00:00`).getTime()) / 86_400_000) + 1, 1), 21)
    : 8;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    return {
      date: dateString(date),
      day: date.getDate(),
      label: index === 0 ? "오늘" : index === 1 ? "내일" : DAY_NAMES[date.getDay()],
    };
  });
}

function updateLabel(updatedAt?: string | null) {
  if (!updatedAt) return "갱신 기록 없음";
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return "갱신 시각 미확인";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 5) return "방금 갱신";
  if (minutes < 60) return `${minutes}분 전 갱신`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전 갱신`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} 갱신`;
}

function TheaterRow({
  theater,
  selectedDate,
  favorite,
  onToggleFavorite,
}: {
  theater: TheaterCard;
  selectedDate: string;
  favorite: boolean;
  onToggleFavorite: (theaterId: number) => void;
}) {
  const hasSchedule = theater.items.length > 0;
  const color = theater.chain === "CGV"
    ? "var(--color-cgv)"
    : theater.chain === "LOTTE"
      ? "var(--color-lotte)"
      : theater.chain === "MEGA"
        ? "var(--color-mega)"
        : "#555";

  return (
    <div className={`flex items-center border-b border-line-soft last:border-b-0 ${hasSchedule ? "hover:bg-ground" : "opacity-60"}`}>
      <Link
        href={hasSchedule ? `/timeline?date=${selectedDate}&theater=${theater.id}` : `/theaters?date=${selectedDate}`}
        aria-disabled={!hasSchedule}
        className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3"
      >
        <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[13px]">{theater.branchName}</b>
          <small className="text-[10px] text-ink-3">
            {!hasSchedule ? "일정 없음" : theater.next ? `다음 상영 ${theater.next}` : "오늘 상영 종료"}
          </small>
          <small className="ml-1 text-[9px] text-ink-3">· {updateLabel(theater.updatedAt)}</small>
        </div>
        {hasSchedule && <span className="text-[11px] font-bold text-app">{theater.items.length}회</span>}
        <span className="text-xs text-ink-3">›</span>
      </Link>
      <button
        type="button"
        onClick={() => onToggleFavorite(theater.id)}
        aria-label={`${theater.branchName} ${favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}`}
        aria-pressed={favorite}
        className={`mr-2 flex h-10 w-10 flex-none items-center justify-center rounded-full text-lg ${favorite ? "text-app" : "text-ink-3 hover:bg-line-soft"}`}
      >
        {favorite ? "★" : "☆"}
      </button>
    </div>
  );
}

export default function TheatersPage() {
  const router = useRouter();
  const [initialized, setInitialized] = useState(false);
  const [selectedDate, setSelectedDate] = useState(dateString());
  const [data, setData] = useState<TheaterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [favoriteTheaters, setFavoriteTheaters] = useState<Set<number>>(new Set());

  useEffect(() => {
    const requestedDate = new URLSearchParams(window.location.search).get("date");
    if (requestedDate && requestedDate >= dateString()) setSelectedDate(requestedDate);
    try {
      const stored = JSON.parse(localStorage.getItem(FAVORITE_THEATERS_KEY) ?? "[]");
      if (Array.isArray(stored)) {
        setFavoriteTheaters(new Set(stored.filter((id): id is number => typeof id === "number")));
      }
    } catch {
      localStorage.removeItem(FAVORITE_THEATERS_KEY);
    }
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    setLoading(true);
    setError(false);
    fetch(`/api/screenings?date=${selectedDate}`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [initialized, selectedDate]);

  const dates = datesUntil(data?.coverage.maxDate);
  const coverageByDate = new Map((data?.coverage.dateCoverage ?? []).map((item) => [item.date, item]));
  const isToday = selectedDate === dateString();

  const theaterCards = useMemo(() => {
    if (!data) return [];
    const screeningsByTheater = new Map<number, ScreeningCard[]>();
    for (const screening of data.screenings) {
      const items = screeningsByTheater.get(screening.theater.id) ?? [];
      items.push(screening);
      screeningsByTheater.set(screening.theater.id, items);
    }
    const cutoff = isToday ? timeString() : "00:00";
    return (data.coverage.theaters ?? []).map((theater) => {
      const items = screeningsByTheater.get(theater.id) ?? [];
      const next = items.map((item) => item.startTime).filter((time) => time >= cutoff).sort()[0] ?? null;
      return { ...theater, items, next };
    });
  }, [data, isToday]);

  const matchingTheaters = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return theaterCards.filter((theater) => theater.branchName.toLowerCase().includes(normalizedQuery));
  }, [query, theaterCards]);

  const favoriteCards = useMemo(() => matchingTheaters
    .filter((theater) => favoriteTheaters.has(theater.id))
    .sort((a, b) => Number(b.items.length > 0) - Number(a.items.length > 0) || a.branchName.localeCompare(b.branchName)),
  [favoriteTheaters, matchingTheaters]);

  const sections = useMemo(() => {
    const filtered = matchingTheaters.filter((theater) => !favoriteTheaters.has(theater.id));
    const map = new Map<string, typeof filtered>();
    for (const theater of filtered) {
      const area = theater.chain === "INDIE" ? "독립영화관" : theater.area;
      const list = map.get(area) ?? [];
      list.push(theater);
      map.set(area, list);
    }
    const order = ["독립영화관", "서울 서부", "일산·고양", "파주", "기타"];
    return [...map.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([area, theaters]) => ({
        area,
        theaters: theaters.sort((a, b) => Number(b.items.length > 0) - Number(a.items.length > 0) || a.branchName.localeCompare(b.branchName)),
      }));
  }, [favoriteTheaters, matchingTheaters]);

  function changeDate(nextDate: string) {
    setSelectedDate(nextDate);
    router.push(`/theaters?date=${nextDate}`);
  }

  function toggleFavorite(theaterId: number) {
    setFavoriteTheaters((current) => {
      const next = new Set(current);
      if (next.has(theaterId)) next.delete(theaterId);
      else next.add(theaterId);
      localStorage.setItem(FAVORITE_THEATERS_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  return (
    <main className="mx-auto min-h-screen max-w-[980px] pb-12">
      <header className="sticky top-0 z-10 border-b border-line bg-white/95 px-4 pb-3 pt-4 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-lg" aria-label="홈으로">←</Link>
          <div>
            <p className="text-[11px] font-bold tracking-[0.16em] text-app">THEATERS</p>
            <h1 className="text-lg font-extrabold">극장별 시간표</h1>
          </div>
          <span className="ml-auto text-[11px] text-ink-3">{data?.coverage.theaterCount ?? 0}개 극장</span>
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-ground px-3 py-2 focus-within:border-app">
          <span aria-hidden="true">🔍</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="극장 검색"
            placeholder="필름포럼, 라이카, 영등포…"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-3"
          />
          {query && <button onClick={() => setQuery("")} className="text-xs text-ink-3" aria-label="검색어 지우기">✕</button>}
        </div>

        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
          {dates.map((item) => {
            const active = item.date === selectedDate;
            const coverage = coverageByDate.get(item.date);
            return (
              <button
                key={item.date}
                onClick={() => changeDate(item.date)}
                className={`flex-none rounded-xl border px-3 py-1.5 text-center ${active ? "border-ink bg-ink text-white" : "border-line bg-panel"}`}
              >
                <small className={`block text-[10px] ${active ? "text-white/70" : "text-ink-3"}`}>{item.label}</small>
                <b className="block text-[15px] leading-tight">{item.day}</b>
                <span className={`text-[9px] ${active ? "text-white/75" : "text-ink-3"}`}>{coverage ? `${coverage.theaterCount}개` : "없음"}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="space-y-6 px-4 py-5">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-line-soft" />)}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-line p-6 text-center text-sm text-ink-3">극장 시간표를 불러오지 못했어요.</div>
        ) : sections.length === 0 && favoriteCards.length === 0 ? (
          <div className="rounded-xl bg-ground p-6 text-center text-sm text-ink-3">검색한 극장을 찾지 못했어요.</div>
        ) : <>
          {favoriteCards.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-extrabold">즐겨찾는 극장</h2>
                <span className="text-[10px] text-ink-3">{favoriteCards.length}곳</span>
              </div>
              <div className="overflow-hidden rounded-2xl border border-app/30 bg-panel">
                {favoriteCards.map((theater) => (
                  <TheaterRow
                    key={theater.id}
                    theater={theater}
                    selectedDate={selectedDate}
                    favorite
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
              </div>
            </section>
          )}
          {favoriteCards.length === 0 && !query && (
            <p className="rounded-xl bg-ground px-3.5 py-2.5 text-[11px] text-ink-3">극장 오른쪽의 ☆를 누르면 자주 가는 극장을 위에 모아볼 수 있어요.</p>
          )}
          {sections.map((section) => (
          <section key={section.area}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-extrabold">{section.area}</h2>
              <span className="text-[10px] text-ink-3">{section.theaters.filter((theater) => theater.items.length > 0).length}/{section.theaters.length}곳 일정 등록</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-line bg-panel">
              {section.theaters.map((theater) => (
                <TheaterRow
                  key={theater.id}
                  theater={theater}
                  selectedDate={selectedDate}
                  favorite={false}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </div>
          </section>
          ))}
        </>}
      </div>

      <AppNav active="theaters" date={selectedDate} />
    </main>
  );
}
