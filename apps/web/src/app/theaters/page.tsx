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

export default function TheatersPage() {
  const router = useRouter();
  const [initialized, setInitialized] = useState(false);
  const [selectedDate, setSelectedDate] = useState(dateString());
  const [data, setData] = useState<TheaterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const requestedDate = new URLSearchParams(window.location.search).get("date");
    if (requestedDate && requestedDate >= dateString()) setSelectedDate(requestedDate);
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

  const sections = useMemo(() => {
    const filtered = theaterCards.filter((theater) => theater.branchName.toLowerCase().includes(query.trim().toLowerCase()));
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
  }, [query, theaterCards]);

  function changeDate(nextDate: string) {
    setSelectedDate(nextDate);
    router.replace(`/theaters?date=${nextDate}`);
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
        ) : sections.length === 0 ? (
          <div className="rounded-xl bg-ground p-6 text-center text-sm text-ink-3">검색한 극장을 찾지 못했어요.</div>
        ) : sections.map((section) => (
          <section key={section.area}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-extrabold">{section.area}</h2>
              <span className="text-[10px] text-ink-3">{section.theaters.filter((theater) => theater.items.length > 0).length}/{section.theaters.length}곳 일정 등록</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-line bg-panel">
              {section.theaters.map((theater) => (
                <Link
                  key={theater.id}
                  href={theater.items.length > 0 ? `/timeline?date=${selectedDate}&theater=${theater.id}` : `/theaters?date=${selectedDate}`}
                  aria-disabled={theater.items.length === 0}
                  className={`flex items-center gap-3 border-b border-line-soft px-3.5 py-3 last:border-b-0 ${theater.items.length > 0 ? "hover:bg-ground" : "opacity-50"}`}
                >
                  <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: theater.chain === "CGV" ? "var(--color-cgv)" : theater.chain === "LOTTE" ? "var(--color-lotte)" : theater.chain === "MEGA" ? "var(--color-mega)" : "#555" }} />
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-[13px]">{theater.branchName}</b>
                    <small className="text-[10px] text-ink-3">
                      {theater.items.length === 0 ? "일정 없음" : theater.next ? `다음 상영 ${theater.next}` : "오늘 상영 종료"}
                    </small>
                  </div>
                  {theater.items.length > 0 && <span className="text-[11px] font-bold text-app">{theater.items.length}회</span>}
                  <span className="text-xs text-ink-3">›</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      <AppNav active="theaters" date={selectedDate} />
    </main>
  );
}
