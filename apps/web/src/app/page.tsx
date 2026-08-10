"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ScreeningCard } from "@mock/types";
import type { DateCoverage, TheaterInfo } from "@/components/HomeHeader";
import AppNav from "@/components/AppNav";

interface HomeResponse {
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
  screenings: ScreeningCard[];
}

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nowHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function buildDates(maxDate?: string | null) {
  const today = new Date();
  const todayString = localDateString(today);
  const last = maxDate && maxDate >= todayString ? new Date(`${maxDate}T00:00:00`) : null;
  const diff = last ? Math.floor((last.getTime() - new Date(`${todayString}T00:00:00`).getTime()) / 86_400_000) + 1 : 8;
  const count = Math.min(Math.max(diff, 1), 21);

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    return {
      date: localDateString(date),
      day: date.getDate(),
      label: index === 0 ? "오늘" : index === 1 ? "내일" : DAY_NAMES[date.getDay()],
    };
  });
}

export default function DiscoverHome() {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(localDateString());
  const [data, setData] = useState<HomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
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
  }, [selectedDate]);

  const dates = buildDates(data?.coverage.maxDate);
  const coverageByDate = new Map((data?.coverage.dateCoverage ?? []).map((item) => [item.date, item]));
  const selectedCoverage = coverageByDate.get(selectedDate);
  const isToday = selectedDate === localDateString();

  const upcomingMovies = useMemo(() => {
    if (!data) return [];
    const cutoff = isToday ? nowHHMM() : "00:00";
    const byMovie = new Map<number, ScreeningCard>();
    for (const screening of data.screenings) {
      if (screening.startTime < cutoff) continue;
      const current = byMovie.get(screening.movie.id);
      if (!current || screening.startTime < current.startTime) byMovie.set(screening.movie.id, screening);
    }
    return [...byMovie.values()].sort((a, b) => a.startTime.localeCompare(b.startTime)).slice(0, 6);
  }, [data, isToday]);

  const goodieMovies = useMemo(() => {
    if (!data) return [];
    const byMovie = new Map<number, ScreeningCard>();
    for (const screening of data.screenings) {
      if (!screening.hasEvent || byMovie.has(screening.movie.id)) continue;
      byMovie.set(screening.movie.id, screening);
    }
    return [...byMovie.values()].slice(0, 5);
  }, [data]);

  const indieTheaters = useMemo(() => {
    if (!data) return [];
    const map = new Map<number, { theater: ScreeningCard["theater"]; items: ScreeningCard[] }>();
    for (const screening of data.screenings) {
      if (screening.theater.chain !== "INDIE") continue;
      const group = map.get(screening.theater.id) ?? { theater: screening.theater, items: [] };
      group.items.push(screening);
      map.set(screening.theater.id, group);
    }
    const cutoff = isToday ? nowHHMM() : "00:00";
    return [...map.values()]
      .map((group) => ({
        ...group,
        next: group.items.map((item) => item.startTime).filter((time) => time >= cutoff).sort()[0] ?? null,
      }))
      .sort((a, b) => {
        if (a.next && b.next) return a.next.localeCompare(b.next);
        if (a.next) return -1;
        if (b.next) return 1;
        return a.theater.branchName.localeCompare(b.theater.branchName);
      })
      .slice(0, 5);
  }, [data, isToday]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const query = search.trim();
    if (!query) return;
    router.push(`/movies?date=${selectedDate}&query=${encodeURIComponent(query)}`);
  }

  return (
    <main className="mx-auto min-h-screen max-w-[980px] pb-12">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 px-4 pb-3 pt-4 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-[0.18em] text-app">CINEMO</p>
            <h1 className="text-xl font-extrabold tracking-tight">오늘, 어떤 영화를 볼까요?</h1>
          </div>
          <Link href="/events" className="rounded-full border border-goodie-line bg-goodie-tint/60 px-3 py-1.5 text-xs font-bold text-goodie">
            🎁 특전
          </Link>
        </div>

        <form onSubmit={submitSearch} className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-ground px-3 py-2 focus-within:border-app">
          <span aria-hidden="true">🔍</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="영화 검색"
            placeholder="보고 싶은 영화를 검색해보세요"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink-3"
          />
          {search.trim() && <button className="text-xs font-bold text-app">찾기</button>}
        </form>

        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
          {dates.map((item) => {
            const active = item.date === selectedDate;
            const status = coverageByDate.get(item.date);
            return (
              <button
                key={item.date}
                onClick={() => setSelectedDate(item.date)}
                className={`flex-none rounded-xl border px-3 py-1.5 text-center ${active ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink"}`}
              >
                <small className={`block text-[10px] ${active ? "text-white/70" : "text-ink-3"}`}>{item.label}</small>
                <b className="block text-[15px] leading-tight">{item.day}</b>
                <span className={`mt-0.5 block text-[9px] ${active ? "text-white/75" : "text-ink-3"}`}>
                  {status ? `${status.theaterCount}개 극장` : "일정 없음"}
                </span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="space-y-7 px-4 py-5">
        {selectedCoverage && data && selectedDate > localDateString() && selectedCoverage.theaterCount < Math.ceil(data.coverage.theaterCount * 0.7) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            아직 일부 극장 일정만 등록됐어요 · {selectedCoverage.theaterCount}/{data.coverage.theaterCount}개 극장
          </div>
        )}

        <section>
          <h2 className="mb-2.5 text-sm font-extrabold">어떻게 찾을까요?</h2>
          <div className="grid grid-cols-3 gap-2">
            <Link href={`/movies?date=${selectedDate}`} className="rounded-2xl border border-line bg-panel p-3 transition-colors hover:border-app">
              <span className="text-xl">🎬</span>
              <b className="mt-2 block text-sm">영화로</b>
              <small className="text-[10px] text-ink-3">포스터부터 보기</small>
            </Link>
            <Link href={`/theaters?date=${selectedDate}`} className="rounded-2xl border border-line bg-panel p-3 transition-colors hover:border-app">
              <span className="text-xl">🏠</span>
              <b className="mt-2 block text-sm">극장으로</b>
              <small className="text-[10px] text-ink-3">자주 가는 곳 보기</small>
            </Link>
            <Link href={`/timeline?date=${selectedDate}`} className="rounded-2xl border border-line bg-panel p-3 transition-colors hover:border-app">
              <span className="text-xl">🕐</span>
              <b className="mt-2 block text-sm">시간으로</b>
              <small className="text-[10px] text-ink-3">지금부터 보기</small>
            </Link>
          </div>
        </section>

        {loading ? (
          <div className="space-y-3" aria-label="시간표 불러오는 중">
            {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-line-soft" />)}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-line bg-panel p-6 text-center text-sm text-ink-3">
            시간표를 불러오지 못했어요.
            <button onClick={() => window.location.reload()} className="ml-2 font-bold text-app">다시 시도</button>
          </div>
        ) : (
          <>
            <section>
              <div className="mb-2.5 flex items-end justify-between">
                <div>
                  <h2 className="text-base font-extrabold">{isToday ? "지금부터 볼 수 있는 영화" : "가장 빠른 상영 영화"}</h2>
                  <p className="text-[11px] text-ink-3">다음 상영 시간이 가까운 순서예요</p>
                </div>
                <Link href={`/movies?date=${selectedDate}`} className="text-xs font-bold text-app">전체 보기 →</Link>
              </div>
              {upcomingMovies.length > 0 ? (
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {upcomingMovies.map((screening) => (
                    <Link key={screening.movie.id} href={`/movies/${screening.movie.id}`} className="w-[112px] flex-none">
                      {screening.movie.posterUrl ? (
                        <img src={screening.movie.posterUrl.replace("/w500/", "/w200/")} alt={`${screening.movie.title} 포스터`} className="h-[160px] w-[112px] rounded-xl bg-line-soft object-cover shadow-sm" />
                      ) : (
                        <div className="flex h-[160px] w-[112px] items-center justify-center rounded-xl bg-line-soft text-2xl">🎞️</div>
                      )}
                      <b className="mt-1.5 block truncate text-[13px]">{screening.movie.title}</b>
                      <span className="text-[11px] font-bold text-app">{screening.startTime}</span>
                      <small className="ml-1 text-[10px] text-ink-3">{screening.theater.branchName}</small>
                    </Link>
                  ))}
                </div>
              ) : <p className="rounded-xl bg-ground p-4 text-center text-xs text-ink-3">남은 상영이 없어요</p>}
            </section>

            {goodieMovies.length > 0 && (
              <section>
                <div className="mb-2.5 flex items-end justify-between">
                  <div>
                    <h2 className="text-base font-extrabold">오늘 특전 있는 영화</h2>
                    <p className="text-[11px] text-ink-3">상영 회차에 연결된 특전이 있어요</p>
                  </div>
                  <Link href="/events" className="text-xs font-bold text-goodie">특전 전체 →</Link>
                </div>
                <div className="flex gap-2.5 overflow-x-auto pb-2">
                  {goodieMovies.map((screening) => (
                    <Link key={screening.movie.id} href={`/movies/${screening.movie.id}`} className="flex w-[230px] flex-none gap-3 rounded-2xl border border-goodie-line bg-goodie-tint/40 p-2.5">
                      {screening.movie.posterUrl ? (
                        <img src={screening.movie.posterUrl.replace("/w500/", "/w200/")} alt={`${screening.movie.title} 포스터`} className="h-[84px] w-[58px] rounded-lg object-cover" />
                      ) : <div className="flex h-[84px] w-[58px] items-center justify-center rounded-lg bg-line-soft">🎞️</div>}
                      <div className="min-w-0 py-1">
                        <b className="block truncate text-[13px]">{screening.movie.title}</b>
                        <span className="mt-2 inline-block rounded-full border border-goodie-line bg-white px-2 py-0.5 text-[10px] font-bold text-goodie">
                          🎁 {screening.eventTypes.map((type) => type === "기타" ? "이벤트" : type).join(" · ")}
                        </span>
                        <small className="mt-2 block truncate text-[10px] text-ink-3">{screening.theater.branchName}</small>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="mb-2.5 flex items-end justify-between">
                <div>
                  <h2 className="text-base font-extrabold">독립영화관 시간표</h2>
                  <p className="text-[11px] text-ink-3">오늘 일정이 있는 독립영화관을 모았어요</p>
                </div>
                <Link href={`/theaters?date=${selectedDate}`} className="text-xs font-bold text-app">전체 보기 →</Link>
              </div>
              <div className="overflow-hidden rounded-2xl border border-line bg-panel">
                {indieTheaters.map((group) => (
                  <Link key={group.theater.id} href={`/movies?date=${selectedDate}&theater=${group.theater.id}`} className="flex items-center gap-3 border-b border-line-soft px-3.5 py-3 last:border-b-0 hover:bg-ground">
                    <span className="h-2.5 w-2.5 flex-none rounded-full bg-[#555]" />
                    <b className="min-w-0 flex-1 truncate text-[13px]">{group.theater.branchName}</b>
                    <span className="text-[11px] text-ink-3">{group.next ? `다음 ${group.next}` : "오늘 상영 종료"}</span>
                    <span className="w-8 text-right text-[11px] font-bold text-app">{group.items.length}회</span>
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      <AppNav active="home" date={selectedDate} />
    </main>
  );
}
