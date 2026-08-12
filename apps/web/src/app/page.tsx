"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ScreeningCard } from "@mock/types";
import { localDateString, type DateCoverage } from "@/lib/dates";
import DateStrip from "@/components/DateStrip";
import AppNav from "@/components/AppNav";
import { SearchIcon, GiftIcon, FilmIcon, HomeIcon, ClockIcon } from "@/components/icons";

interface HomeResponse {
  date: string;
  coverage: {
    label: string;
    theaterCount: number;
    maxDate?: string | null;
    dateCoverage?: DateCoverage[];
  };
  updatedAt: string;
  goodsUpdatedAt: string;
  upcomingMovies: ScreeningCard[];
  goodieMovies: ScreeningCard[];
  indieTheaters: {
    theater: ScreeningCard["theater"];
    screeningCount: number;
    next: string | null;
  }[];
}

export default function DiscoverHome() {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(localDateString());
  const [data, setData] = useState<HomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const restoreDate = () => {
      const requested = new URLSearchParams(window.location.search).get("date");
      setSelectedDate(requested && requested >= localDateString() ? requested : localDateString());
    };
    restoreDate();
    window.addEventListener("popstate", restoreDate);
    return () => window.removeEventListener("popstate", restoreDate);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetch(`/api/screenings?date=${selectedDate}&view=home`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [selectedDate]);

  const coverageByDate = new Map((data?.coverage.dateCoverage ?? []).map((item) => [item.date, item]));
  const selectedCoverage = coverageByDate.get(selectedDate);
  const isToday = selectedDate === localDateString();
  /** 히어로: 다음 상영이 가장 가까운 영화 1편 — 나머지는 아래 포스터 레일로 */
  const featured = data?.upcomingMovies[0] ?? null;
  const railMovies = data?.upcomingMovies.slice(1) ?? [];

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const query = search.trim();
    if (!query) return;
    router.push(`/movies?date=${selectedDate}&query=${encodeURIComponent(query)}`);
  }

  function changeDate(date: string) {
    setSelectedDate(date);
    window.history.pushState(null, "", `/?date=${date}`);
  }

  return (
    <main className="mx-auto min-h-screen max-w-[980px] pb-12">
      <header className="sticky top-0 z-20 border-b border-line bg-panel/95 px-4 pb-3 pt-4 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-extrabold tracking-[0.24em] text-app">CINEMO</p>
            <h1 className="text-[22px] font-[900] tracking-[-0.02em]">오늘, 어떤 영화를 볼까요?</h1>
          </div>
          <Link href="/events" className="inline-flex items-center gap-1.5 rounded-full border border-goodie-line bg-goodie-tint/60 px-3 py-1.5 text-xs font-bold text-goodie">
            <GiftIcon size={12} /> 특전
          </Link>
        </div>

        <form onSubmit={submitSearch} className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-ground px-3 py-2 focus-within:border-app">
          <SearchIcon size={15} className="text-ink-3" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="영화 검색"
            placeholder="보고 싶은 영화를 검색해보세요"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-3"
          />
          {search.trim() && <button className="text-xs font-bold text-app">찾기</button>}
        </form>

        <DateStrip
          selectedDate={selectedDate}
          onChange={changeDate}
          maxDate={data?.coverage.maxDate}
          dateCoverage={data?.coverage.dateCoverage}
          loading={!data}
        />
      </header>

      <div className="space-y-7 px-4 py-5">
        {selectedCoverage && data && selectedDate > localDateString() && selectedCoverage.theaterCount < Math.ceil(data.coverage.theaterCount * 0.7) && (
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
            아직 일부 극장 일정만 등록됐어요 · {selectedCoverage.theaterCount}/{data.coverage.theaterCount}개 극장
          </div>
        )}

        {!error && (loading ? (
          <div className="h-[204px] animate-pulse rounded-3xl bg-line-soft" role="status" aria-label="가까운 상영 불러오는 중" />
        ) : featured && (
          <section aria-label="가장 가까운 상영">
            <Link href={`/movies/${featured.movie.id}`} className="relative block overflow-hidden rounded-3xl border border-line bg-panel transition-colors hover:border-app/60">
              {featured.movie.posterUrl && (
                <>
                  <img
                    src={featured.movie.posterUrl.replace("/w500/", "/w200/")}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-ground/85 via-ground/55 to-ground/25" />
                </>
              )}
              <div className="relative flex items-center gap-4 p-4">
                {featured.movie.posterUrl ? (
                  <img
                    src={featured.movie.posterUrl}
                    alt={`${featured.movie.title} 포스터`}
                    className="h-[172px] w-[118px] flex-none rounded-xl bg-line-soft object-cover shadow-lg"
                  />
                ) : (
                  <div className="flex h-[172px] w-[118px] flex-none items-center justify-center rounded-xl bg-line-soft text-ink-3"><FilmIcon size={26} /></div>
                )}
                <div className="min-w-0">
                  <p className="text-[11px] font-extrabold tracking-[0.18em] text-app">{isToday ? "NOW SHOWING" : "UPCOMING"}</p>
                  <b className="mt-1.5 block text-[21px] font-[900] leading-snug tracking-[-0.02em] line-clamp-2">{featured.movie.title}</b>
                  <p className="mt-2 text-[15px] font-extrabold tabular-nums text-app">
                    {featured.startTime}
                    <span className="ml-1.5 text-[12px] font-semibold text-ink-2">{featured.theater.branchName}</span>
                  </p>
                  {featured.eventTypes.length > 0 && (
                    <span className="mt-2.5 inline-flex items-center gap-1 rounded-full border border-goodie-line bg-goodie-tint/70 px-2 py-0.5 text-[10px] font-bold text-goodie">
                      <GiftIcon size={10} /> {featured.eventTypes.map((type) => type === "기타" ? "이벤트" : type).join(" · ")}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </section>
        ))}

        <section>
          <h2 className="mb-2.5 text-sm font-extrabold">어떻게 찾을까요?</h2>
          <div className="grid grid-cols-3 gap-2">
            <Link href={`/movies?date=${selectedDate}`} className="rounded-2xl border border-line bg-panel p-3 transition-colors hover:border-app">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-app-tint text-app"><FilmIcon size={15} /></span>
              <b className="mt-2 block text-sm">영화로</b>
              <small className="text-[10px] text-ink-3">포스터부터 보기</small>
            </Link>
            <Link href={`/theaters?date=${selectedDate}`} className="rounded-2xl border border-line bg-panel p-3 transition-colors hover:border-app">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-app-tint text-app"><HomeIcon size={15} /></span>
              <b className="mt-2 block text-sm">극장으로</b>
              <small className="text-[10px] text-ink-3">자주 가는 곳 보기</small>
            </Link>
            <Link href={`/timeline?date=${selectedDate}`} className="rounded-2xl border border-line bg-panel p-3 transition-colors hover:border-app">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-app-tint text-app"><ClockIcon size={15} /></span>
              <b className="mt-2 block text-sm">시간으로</b>
              <small className="text-[10px] text-ink-3">지금부터 보기</small>
            </Link>
          </div>
        </section>

        {loading ? (
          <div className="space-y-3" role="status" aria-label="시간표 불러오는 중">
            {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-line-soft" />)}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-line bg-panel p-6 text-center text-sm text-ink-3" role="alert">
            시간표를 불러오지 못했어요.
            <button onClick={() => window.location.reload()} className="ml-2 font-bold text-app">다시 시도</button>
          </div>
        ) : (
          <>
            {railMovies.length > 0 && (
              <section>
                <div className="mb-2.5 flex items-end justify-between">
                  <div>
                    <h2 className="text-base font-extrabold tracking-tight">{isToday ? "지금부터 볼 수 있는 영화" : "가장 빠른 상영 영화"}</h2>
                    <p className="text-[11px] text-ink-3">다음 상영 시간이 가까운 순서예요</p>
                  </div>
                  <Link href={`/movies?date=${selectedDate}`} className="text-xs font-bold text-app">전체 보기 →</Link>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {railMovies.map((screening) => (
                    <Link key={screening.movie.id} href={`/movies/${screening.movie.id}`} className="w-[112px] flex-none">
                      {screening.movie.posterUrl ? (
                        <img src={screening.movie.posterUrl.replace("/w500/", "/w200/")} alt={`${screening.movie.title} 포스터`} className="h-[160px] w-[112px] rounded-xl bg-line-soft object-cover shadow-sm" />
                      ) : (
                        <div className="flex h-[160px] w-[112px] items-center justify-center rounded-xl bg-line-soft text-ink-3"><FilmIcon size={24} /></div>
                      )}
                      <b className="mt-1.5 block truncate text-[13px]">{screening.movie.title}</b>
                      <span className="text-[11px] font-bold text-app">{screening.startTime}</span>
                      <small className="ml-1 text-[10px] text-ink-3">{screening.theater.branchName}</small>
                    </Link>
                  ))}
                </div>
              </section>
            )}
            {data && data.upcomingMovies.length === 0 && (
              <p className="rounded-xl bg-ground p-4 text-center text-xs text-ink-3">남은 상영이 없어요</p>
            )}

            {data && data.goodieMovies.length > 0 && (
              <section>
                <div className="mb-2.5 flex items-end justify-between">
                  <div>
                    <h2 className="text-base font-extrabold tracking-tight">오늘 특전 있는 영화</h2>
                    <p className="text-[11px] text-ink-3">상영 회차에 연결된 특전이 있어요</p>
                  </div>
                  <Link href="/events" className="text-xs font-bold text-goodie">특전 전체 →</Link>
                </div>
                <div className="flex gap-2.5 overflow-x-auto pb-2">
                  {data.goodieMovies.map((screening) => (
                    <Link key={screening.movie.id} href={`/movies/${screening.movie.id}`} className="flex w-[230px] flex-none gap-3 rounded-2xl border border-goodie-line bg-goodie-tint/40 p-2.5">
                      {screening.movie.posterUrl ? (
                        <img src={screening.movie.posterUrl.replace("/w500/", "/w200/")} alt={`${screening.movie.title} 포스터`} className="h-[84px] w-[58px] rounded-lg object-cover" />
                      ) : <div className="flex h-[84px] w-[58px] items-center justify-center rounded-lg bg-line-soft text-ink-3"><FilmIcon size={18} /></div>}
                      <div className="min-w-0 py-1">
                        <b className="block truncate text-[13px]">{screening.movie.title}</b>
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-goodie-line bg-panel px-2 py-0.5 text-[10px] font-bold text-goodie">
                          <GiftIcon size={10} /> {screening.eventTypes.map((type) => type === "기타" ? "이벤트" : type).join(" · ")}
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
                  <h2 className="text-base font-extrabold tracking-tight">독립영화관 시간표</h2>
                  <p className="text-[11px] text-ink-3">오늘 일정이 있는 독립영화관을 모았어요</p>
                </div>
                <Link href={`/theaters?date=${selectedDate}`} className="text-xs font-bold text-app">전체 보기 →</Link>
              </div>
              <div className="overflow-hidden rounded-2xl border border-line bg-panel">
                {data?.indieTheaters.map((group) => (
                  <Link key={group.theater.id} href={`/timeline?date=${selectedDate}&theater=${group.theater.id}`} className="flex items-center gap-3 border-b border-line-soft px-3.5 py-3 last:border-b-0 hover:bg-ground">
                    <span className="h-2.5 w-2.5 flex-none rounded-full bg-indie" />
                    <b className="min-w-0 flex-1 truncate text-[13px]">{group.theater.branchName}</b>
                    <span className="text-[11px] text-ink-3">{group.next ? `다음 ${group.next}` : "오늘 상영 종료"}</span>
                    <span className="w-8 text-right text-[11px] font-bold text-app">{group.screeningCount}회</span>
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
