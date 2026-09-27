"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ScreeningCard } from "@mock/types";
import { localDateString, type DateCoverage } from "@/lib/dates";
import DateStrip from "@/components/DateStrip";

/** coverage.theaters 항목 — 상영 없는 극장도 카탈로그로 포함 (쉼/미등록 표시용) */
interface TheaterListItem {
  id: number;
  chain: string;
  branchName: string;
  area: string;
  openToday: boolean;
  scheduleStatus: "open" | "closed" | "uncollected";
  updatedAt: string | null;
}

/** /api/screenings?date=X 전체 응답 (홈 요약 아님) */
interface ScreeningsResponse {
  date: string;
  coverage: {
    label: string;
    theaterCount: number;
    maxDate?: string | null;
    dateCoverage?: DateCoverage[];
    theaters?: TheaterListItem[];
  };
  updatedAt: string;
  screenings: ScreeningCard[];
}

type Lens = "time" | "movie" | "theater";

const CHAIN_LABEL: Record<string, string> = { CGV: "CGV", LOTTE: "롯데", MEGA: "메가", INDIE: "인디" };
const FAV_KEY = "cinemo:favTheaters";

/** "HH:MM" → 분. 새벽(06시 이전)은 +24시로 밀어 심야 정렬. */
function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h < 6 ? h + 24 : h) * 60 + m;
}
function shortTheater(name: string): string {
  return name.replace(/^(CGV|롯데시네마|메가박스)\s?/, "");
}
function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function TicketExplorer() {
  const [selectedDate, setSelectedDate] = useState(localDateString());
  const [data, setData] = useState<ScreeningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [lens, setLens] = useState<Lens>("time");
  const [fNow, setFNow] = useState(false);
  const [fGoodie, setFGoodie] = useState(false);
  const [fIndie, setFIndie] = useState(false);
  const [fFav, setFFav] = useState(false);
  const [search, setSearch] = useState("");
  const [favs, setFavs] = useState<Set<number>>(new Set());

  // 즐겨찾기 복원
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) setFavs(new Set(JSON.parse(raw)));
    } catch {}
  }, []);
  const toggleFav = useCallback((id: number) => {
    setFavs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { localStorage.setItem(FAV_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  // 날짜 URL 복원
  useEffect(() => {
    const restore = () => {
      const requested = new URLSearchParams(window.location.search).get("date");
      setSelectedDate(requested && requested >= localDateString() ? requested : localDateString());
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetch(`/api/screenings?date=${selectedDate}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [selectedDate]);

  function changeDate(date: string) {
    setSelectedDate(date);
    window.history.pushState(null, "", `/?date=${date}`);
  }

  const isToday = selectedDate === localDateString();
  const cutoff = isToday ? nowHHMM() : "00:00";

  const filtered = useMemo(() => {
    const list = data?.screenings ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((s) => {
      if (fNow && s.startTime < cutoff) return false;
      if (fGoodie && !s.hasEvent) return false;
      if (fIndie && s.theater.chain !== "INDIE") return false;
      if (fFav && !favs.has(s.theater.id)) return false;
      if (q && !(`${s.movie.title} ${s.theater.branchName}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [data, fNow, fGoodie, fIndie, fFav, favs, search, cutoff]);

  const stats = useMemo(() => ({
    tickets: filtered.length,
    movies: new Set(filtered.map((s) => s.movie.id)).size,
    theaters: new Set(filtered.map((s) => s.theater.id)).size,
  }), [filtered]);

  const selectedCoverage = (data?.coverage.dateCoverage ?? []).find((c) => c.date === selectedDate);

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1240px] pb-24">
      {/* ── Top ── */}
      <header className="sticky top-0 z-30 border-b border-line bg-ground/90 px-4 pb-2 pt-3.5 backdrop-blur-md lg:px-8">
        <div className="flex items-center justify-between">
          <span className="font-display text-[26px] leading-none tracking-tight">
            CINEMO<span className="text-tk">.</span>
          </span>
          <Link href="/events" className="inline-flex items-center gap-1.5 rounded-full border border-tk/40 bg-tk/10 px-3 py-1.5 text-xs font-bold text-tk">
            🎁 특전
          </Link>
        </div>

        <label className="mt-3 flex items-center gap-2.5 rounded-xl border border-line bg-panel px-3 py-2.5 focus-within:border-tk/60">
          <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-ink-3" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="영화·극장 검색"
            placeholder='영화 · 극장 검색  ("일산", "인턴"...)'
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
          />
          {search && <button onClick={() => setSearch("")} className="font-mono text-xs text-ink-3">✕</button>}
        </label>

        <DateStrip
          selectedDate={selectedDate}
          onChange={changeDate}
          maxDate={data?.coverage.maxDate}
          dateCoverage={data?.coverage.dateCoverage}
          loading={!data}
        />
      </header>

      {/* ── Lens + filters ── */}
      <div className="sticky top-[164px] z-20 border-b border-line bg-ground/90 px-4 py-2.5 backdrop-blur-md lg:px-8">
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-panel p-1">
          {([["time", "시간순"], ["movie", "영화순"], ["theater", "극장순"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setLens(key)}
              aria-pressed={lens === key}
              className={`rounded-lg py-2 text-sm font-bold transition-colors ${lens === key ? "bg-tk text-white shadow-[0_2px_10px] shadow-tk/30" : "text-ink-2"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
          <Chip on={fNow} onClick={() => setFNow((v) => !v)}>🕒 지금이후</Chip>
          <Chip on={fGoodie} onClick={() => setFGoodie((v) => !v)}>🎁 특전만</Chip>
          <Chip on={fFav} onClick={() => setFFav((v) => !v)}>★ 즐겨찾기{favs.size ? ` ${favs.size}` : ""}</Chip>
          <Chip on={fIndie} onClick={() => setFIndie((v) => !v)}>인디영화관</Chip>
        </div>
      </div>

      {/* ── Count ── */}
      <div className="flex items-baseline justify-between px-4 pt-3.5 lg:px-8">
        <p className="font-display text-xl">
          {loading ? "불러오는 중…" : <><span className="text-tk">{stats.tickets}</span> 티켓 · {stats.movies}편 · {stats.theaters}개 극장</>}
        </p>
        <span className="font-mono text-xs text-ink-3">{isToday ? `현재 ${cutoff}` : selectedDate}</span>
      </div>

      {selectedCoverage && data && selectedDate > localDateString() && selectedCoverage.theaterCount < Math.ceil(data.coverage.theaterCount * 0.7) && (
        <p className="mx-4 mt-3 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-300 lg:mx-8">
          아직 일부 극장 일정만 등록됐어요 · {selectedCoverage.theaterCount}/{data.coverage.theaterCount}개 극장
        </p>
      )}

      {/* ── Body ── */}
      <div className="px-4 py-4 lg:px-8">
        {loading ? (
          <div className="space-y-2.5" role="status" aria-label="시간표 불러오는 중">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-line-soft" />)}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-line bg-panel p-8 text-center text-sm text-ink-3" role="alert">
            시간표를 불러오지 못했어요.
            <button onClick={() => window.location.reload()} className="ml-2 font-bold text-tk">다시 시도</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-line bg-panel p-10 text-center text-sm text-ink-3">
            조건에 맞는 상영이 없어요.
            <button onClick={() => { setFNow(false); setFGoodie(false); setFIndie(false); setFFav(false); setSearch(""); }} className="ml-2 font-bold text-tk">필터 초기화</button>
          </div>
        ) : lens === "time" ? (
          <TimeLens list={filtered} cutoff={cutoff} />
        ) : lens === "movie" ? (
          <MovieLens list={filtered} cutoff={cutoff} />
        ) : (
          <TheaterLens list={filtered} allTheaters={data?.coverage.theaters ?? []} favs={favs} onToggleFav={toggleFav} />
        )}
      </div>

      <p className="mx-4 mt-2 rounded-xl border border-dashed border-line bg-panel px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-3 lg:mx-8">
        ※ 상영 데이터는 {data?.coverage.label ?? "수도권 일부"} 극장 기준. 없는 지역은 아직 수집 대상이 아니에요.
      </p>

      {/* ── Bottom nav (mobile) ── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto grid max-w-[1240px] grid-cols-2 border-t border-line bg-ground/95 backdrop-blur-md lg:hidden">
        <span className="flex flex-col items-center gap-0.5 py-2.5 pb-4 text-[11px] font-bold text-tk">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M16 5v14M8 5v14" strokeDasharray="2 2" /></svg>
          탐색
        </span>
        <Link href="/events" className="flex flex-col items-center gap-0.5 py-2.5 pb-4 text-[11px] font-bold text-ink-3">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7" /></svg>
          특전
        </Link>
      </nav>
    </main>
  );
}

// ─────────────────────────────────────────────

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`flex-none whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${on ? "border-tk/40 bg-tk/10 text-tk" : "border-line bg-panel text-ink-2"}`}
    >
      {children}
    </button>
  );
}

function GoodieBadge({ types }: { types: ScreeningCard["eventTypes"] }) {
  if (!types.length) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-tk/40 bg-tk/10 px-1.5 py-0.5 text-[11px] font-bold text-tk">
      🎁 {types.map((t) => (t === "기타" ? "이벤트" : t)).join("·")}
    </span>
  );
}

function SeatTag({ seats }: { seats: number | null }) {
  if (seats == null) return null;
  const low = seats <= 15;
  return <span className={`font-mono text-[11px] ${low ? "font-bold text-tk" : "text-ink-3"}`}>{low ? "매진임박 " : "잔여 "}{seats}석</span>;
}

function PosterStub({ movie, format, className = "" }: { movie: ScreeningCard["movie"]; format: string | null; className?: string }) {
  if (movie.posterUrl) {
    return <img src={movie.posterUrl.replace("/w500/", "/w200/")} alt={`${movie.title} 포스터`} className={`object-cover ${className}`} />;
  }
  return (
    <div className={`grid place-items-center bg-gradient-to-br from-panel-2 to-ground p-1.5 text-center font-display text-[10px] leading-tight text-ink ${className}`}>
      {format && <span className="absolute left-1 top-1 font-mono text-[8px] text-ink-3">{format}</span>}
      {movie.title.slice(0, 18)}
    </div>
  );
}

/** 티켓 카드 — 시간순 렌즈의 원자 단위 */
function Ticket({ s, cutoff }: { s: ScreeningCard; cutoff: string }) {
  const soon = s.startTime >= cutoff && toMin(s.startTime) < toMin(cutoff) + 40;
  return (
    <div className={`relative grid grid-cols-[62px_1fr_78px] overflow-hidden rounded-xl border bg-panel ${soon ? "border-tk/40" : "border-line"}`}>
      {/* 스텁 절취선 노치 */}
      <span className="absolute -top-1.5 right-[78px] z-[2] h-3 w-3 translate-x-1/2 rounded-full bg-ground" />
      <span className="absolute -bottom-1.5 right-[78px] z-[2] h-3 w-3 translate-x-1/2 rounded-full bg-ground" />
      <div className="relative border-r border-line">
        <PosterStub movie={s.movie} format={s.format} className="h-full w-full" />
      </div>
      <div className="min-w-0 p-2.5 pl-3">
        <p className="truncate font-bold">{s.movie.title}</p>
        <p className="mt-0.5 truncate text-[13px] text-ink-2">
          <span className="font-semibold text-ink">{CHAIN_LABEL[s.theater.chain]}</span> {shortTheater(s.theater.branchName)}
          {s.screenName ? ` · ${s.screenName}` : ""}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <GoodieBadge types={s.eventTypes} />
          <SeatTag seats={s.remainingSeats} />
        </div>
      </div>
      <div className="flex flex-col items-center justify-center gap-0.5 border-l-2 border-dashed border-line bg-gradient-to-b from-panel to-panel-2 px-1 py-2">
        <span className={`font-mono text-lg font-semibold tabular-nums leading-none ${soon ? "text-tk" : "text-ink"}`}>{s.startTime}</span>
        {s.endTime && <span className="font-mono text-[10px] text-ink-3">~{s.endTime}</span>}
        {s.bookingUrl && (
          <a href={s.bookingUrl} target="_blank" rel="noreferrer" className="mt-0.5 text-[10px] font-bold text-tk">예매 ↗</a>
        )}
      </div>
    </div>
  );
}

function Divider({ label, note }: { label: string; note: string }) {
  return (
    <div className="mb-1 mt-3 flex items-center gap-2.5 first:mt-0">
      <span className="font-display text-lg">{label}</span>
      <span className="h-0 flex-1 border-t-2 border-dashed border-line" />
      <span className="font-mono text-[11px] text-ink-3">{note}</span>
    </div>
  );
}

function TimeLens({ list, cutoff }: { list: ScreeningCard[]; cutoff: string }) {
  const sorted = [...list].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const eve = sorted.filter((s) => toMin(s.startTime) < toMin("21:00"));
  const late = sorted.filter((s) => toMin(s.startTime) >= toMin("21:00"));
  return (
    <div className="space-y-1.5">
      {eve.length > 0 && <>
        <Divider label="저녁까지" note={`~21:00`} />
        <div className="grid gap-2 lg:grid-cols-2">{eve.map((s) => <Ticket key={s.id} s={s} cutoff={cutoff} />)}</div>
      </>}
      {late.length > 0 && <>
        <Divider label="심야" note="21:00~" />
        <div className="grid gap-2 lg:grid-cols-2">{late.map((s) => <Ticket key={s.id} s={s} cutoff={cutoff} />)}</div>
      </>}
    </div>
  );
}

function groupBy(list: ScreeningCard[], key: (s: ScreeningCard) => string | number) {
  const map = new Map<string | number, ScreeningCard[]>();
  for (const s of list) {
    const k = key(s);
    (map.get(k) ?? map.set(k, []).get(k)!).push(s);
  }
  return [...map.values()]
    .map((items) => items.sort((a, b) => toMin(a.startTime) - toMin(b.startTime)))
    .sort((a, b) => toMin(a[0].startTime) - toMin(b[0].startTime));
}

function MovieLens({ list, cutoff }: { list: ScreeningCard[]; cutoff: string }) {
  const groups = groupBy(list, (s) => s.movie.id);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((items) => {
        const m = items[0].movie;
        const types = [...new Set(items.flatMap((i) => i.eventTypes))];
        const theaters = new Set(items.map((i) => i.theater.id)).size;
        return (
          <div key={m.id} className="grid grid-cols-[92px_1fr] overflow-hidden rounded-2xl border border-line bg-panel">
            <Link href={`/movies/${m.id}`} className="relative border-r border-line">
              <PosterStub movie={m} format={null} className="h-full w-full" />
              {types.length > 0 && <span className="absolute right-1.5 top-1.5 rounded bg-tk px-1.5 py-0.5 text-[10px] font-bold text-white">🎁</span>}
            </Link>
            <div className="min-w-0 p-3">
              <Link href={`/movies/${m.id}`} className="block truncate font-bold hover:text-tk">{m.title}</Link>
              <p className="mt-1 font-mono text-[11px] text-ink-3">
                {items.length}회 · {theaters}개 극장{types.length ? <span className="text-tk"> · {types.map((t) => t === "기타" ? "이벤트" : t).join("·")}</span> : null}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {items.slice(0, 10).map((s) => {
                  const soon = s.startTime >= cutoff && toMin(s.startTime) < toMin(cutoff) + 40;
                  const low = s.remainingSeats != null && s.remainingSeats <= 15;
                  const pill = `rounded-md border px-1.5 py-0.5 font-mono text-[12px] tabular-nums ${low ? "border-tk/40 text-tk" : "border-line bg-panel-2 text-ink"} ${soon ? "font-bold" : ""}`;
                  return s.bookingUrl
                    ? <a key={s.id} href={s.bookingUrl} target="_blank" rel="noreferrer" className={pill} title={shortTheater(s.theater.branchName)}>{s.startTime}</a>
                    : <span key={s.id} className={pill} title={shortTheater(s.theater.branchName)}>{s.startTime}</span>;
                })}
                {items.length > 10 && <span className="self-center font-mono text-[11px] text-ink-3">+{items.length - 10}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TheaterLens({ list, allTheaters, favs, onToggleFav }: { list: ScreeningCard[]; allTheaters: TheaterListItem[]; favs: Set<number>; onToggleFav: (id: number) => void }) {
  let groups = groupBy(list, (s) => s.theater.id);
  // 즐겨찾기 극장 먼저
  groups = groups.sort((a, b) => Number(favs.has(b[0].theater.id)) - Number(favs.has(a[0].theater.id)));

  // 상영 없는 극장(주로 인디관) — 카탈로그엔 있으나 이 날짜 회차 없음. 찾을 수 있게 별도 노출.
  const openIds = new Set(list.map((s) => s.theater.id));
  const dormant = allTheaters
    .filter((t) => !openIds.has(t.id) && t.scheduleStatus !== "open" && t.chain === "INDIE")
    .sort((a, b) => Number(favs.has(b.id)) - Number(favs.has(a.id)) || a.branchName.localeCompare(b.branchName));

  return (
    <>
    <div className="grid gap-3 lg:grid-cols-2">
      {groups.map((items) => {
        const t = items[0].theater;
        const fav = favs.has(t.id);
        return (
          <div key={t.id} className="rounded-2xl border border-line bg-panel p-3.5">
            <div className="mb-2 flex items-center justify-between border-b-2 border-dashed border-line pb-2">
              <div className="min-w-0">
                <span className="font-display text-lg">{shortTheater(t.branchName)}</span>
                <span className="ml-2 font-mono text-[11px] text-ink-3">{CHAIN_LABEL[t.chain]} · {items.length}회</span>
              </div>
              <button onClick={() => onToggleFav(t.id)} aria-pressed={fav} aria-label="즐겨찾기" className={`flex-none text-lg ${fav ? "text-tk" : "text-ink-3"}`}>
                {fav ? "★" : "☆"}
              </button>
            </div>
            <div className="divide-y divide-line-soft">
              {items.map((s) => (
                <div key={s.id} className="grid grid-cols-[48px_1fr_auto] items-center gap-2.5 py-1.5">
                  <span className={`font-mono font-semibold tabular-nums ${s.remainingSeats != null && s.remainingSeats <= 15 ? "text-tk" : "text-ink"}`}>{s.startTime}</span>
                  <div className="min-w-0">
                    <Link href={`/movies/${s.movie.id}`} className="block truncate text-[14px] font-medium hover:text-tk">{s.movie.title}</Link>
                    <p className="truncate text-[11px] text-ink-3">
                      {s.format ?? ""}{s.remainingSeats != null ? ` · ${s.remainingSeats <= 15 ? "매진임박" : `잔여 ${s.remainingSeats}석`}` : ""}
                      {s.eventTypes.length ? <span className="text-tk"> · 🎁 {s.eventTypes.map((x) => x === "기타" ? "이벤트" : x).join("·")}</span> : null}
                    </p>
                  </div>
                  {s.bookingUrl && <a href={s.bookingUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-tk">예매↗</a>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>

    {dormant.length > 0 && (
      <section className="mt-5">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="font-display text-lg text-ink-2">일정 미등록 독립영화관</span>
          <span className="h-0 flex-1 border-t-2 border-dashed border-line" />
          <span className="font-mono text-[11px] text-ink-3">상영 수집 예정</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {dormant.map((t) => {
            const fav = favs.has(t.id);
            return (
              <div key={t.id} className="flex items-center justify-between rounded-xl border border-dashed border-line bg-panel/60 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink-2">{t.branchName}</p>
                  <p className="font-mono text-[11px] text-ink-3">{t.scheduleStatus === "closed" ? "이 날짜 쉼" : "상영 정보 미수집"}</p>
                </div>
                <button onClick={() => onToggleFav(t.id)} aria-pressed={fav} aria-label="즐겨찾기" className={`flex-none text-lg ${fav ? "text-tk" : "text-ink-3"}`}>
                  {fav ? "★" : "☆"}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    )}
    </>
  );
}
