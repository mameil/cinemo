"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ScreeningCard, EventPreview } from "@mock/types";
import { CHAIN_COLOR, GOODIE_BADGE_CLASS, seatStatus, formatLabel, timeSlot } from "@/lib/utils";
import EventPeek, { type PeekTarget } from "@/components/EventPeek";

type TimeRange = "now" | "evening" | "late" | "all";
const FAVORITE_THEATERS_KEY = "cinemo-favorite-theaters";

interface TimelineGroup {
  key: string;
  movie: ScreeningCard["movie"];
  theater: ScreeningCard["theater"];
  items: ScreeningCard[];
  firstTime: string;
}

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function inRange(time: string, range: TimeRange, isToday: boolean) {
  if (range === "now") return !isToday || time >= currentTime();
  if (range === "evening") return time >= "17:00" && time < "22:00";
  if (range === "late") return time >= "22:00" || time < "05:00";
  return true;
}

function groupScreenings(screenings: ScreeningCard[], favoriteTheaters: Set<number>, favoritesFirst: boolean): TimelineGroup[] {
  const map = new Map<string, TimelineGroup>();
  for (const screening of screenings) {
    const key = `${screening.movie.id}-${screening.theater.id}`;
    const group = map.get(key) ?? {
      key,
      movie: screening.movie,
      theater: screening.theater,
      items: [],
      firstTime: screening.startTime,
    };
    group.items.push(screening);
    if (screening.startTime < group.firstTime) group.firstTime = screening.startTime;
    map.set(key, group);
  }
  return [...map.values()]
    .map((group) => ({ ...group, items: group.items.sort((a, b) => a.startTime.localeCompare(b.startTime)) }))
    .sort((a, b) => {
      if (favoritesFirst) {
        const favoriteOrder = Number(favoriteTheaters.has(b.theater.id)) - Number(favoriteTheaters.has(a.theater.id));
        if (favoriteOrder !== 0) return favoriteOrder;
      }
      return a.firstTime.localeCompare(b.firstTime);
    });
}

export default function TimelineView({
  screenings,
  eventPreviews = {},
  isToday = false,
  selectedDate,
}: {
  screenings: ScreeningCard[];
  eventPreviews?: Record<string, EventPreview[]>;
  isToday?: boolean;
  selectedDate: string;
}) {
  const [range, setRange] = useState<TimeRange>(isToday ? "now" : "all");
  const [peek, setPeek] = useState<PeekTarget | null>(null);
  const [favoriteTheaters, setFavoriteTheaters] = useState<Set<number>>(new Set());
  const [favoritesFirst, setFavoritesFirst] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(FAVORITE_THEATERS_KEY) ?? "[]");
      if (Array.isArray(stored)) {
        setFavoriteTheaters(new Set(stored.filter((id): id is number => typeof id === "number")));
      }
    } catch {
      localStorage.removeItem(FAVORITE_THEATERS_KEY);
    }
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("range");
    const valid: TimeRange[] = ["now", "evening", "late", "all"];
    setRange(valid.includes(requested as TimeRange) ? requested as TimeRange : isToday ? "now" : "all");
  }, [isToday, selectedDate]);

  useEffect(() => {
    const restore = () => {
      const requested = new URLSearchParams(window.location.search).get("range");
      if (["now", "evening", "late", "all"].includes(requested ?? "")) setRange(requested as TimeRange);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const selectRange = (next: TimeRange) => {
    setRange(next);
    const params = new URLSearchParams(window.location.search);
    params.set("range", next);
    window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
  };

  const ranged = useMemo(
    () => screenings.filter((screening) => inRange(screening.startTime, range, isToday)),
    [screenings, range, isToday]
  );
  const groups = useMemo(
    () => groupScreenings(ranged, favoriteTheaters, favoritesFirst),
    [favoriteTheaters, favoritesFirst, ranged]
  );

  const openPeek = (screening: ScreeningCard, type: string | null) => {
    const previews = (eventPreviews[`${screening.movie.id}-${screening.theater.chain}`] ?? []).filter(
      (preview) => preview.theaterIds.length === 0 || preview.theaterIds.includes(screening.theater.id)
    );
    setPeek({
      movieTitle: screening.movie.title,
      type,
      theaterName: screening.theater.branchName,
      entries: [{ chain: screening.theater.chain, previews }],
    });
  };

  let lastSlot = "";

  return (
    <div className="p-3">
      <div className="mb-3 flex gap-1.5 overflow-x-auto">
        {([
          ["now", isToday ? "지금부터" : "하루 시작부터"],
          ["evening", "저녁 17~22시"],
          ["late", "심야 22시 이후"],
          ["all", "전체"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => selectRange(key)}
            className={`flex-none rounded-full border px-3 py-1.5 text-[11.5px] font-bold ${range === key ? "border-app bg-app-tint text-app" : "border-line bg-panel text-ink-3"}`}
          >
            {label}
          </button>
        ))}
        {favoriteTheaters.size > 0 && (
          <button
            type="button"
            onClick={() => setFavoritesFirst((current) => !current)}
            aria-pressed={favoritesFirst}
            className={`flex-none rounded-full border px-3 py-1.5 text-[11.5px] font-bold ${favoritesFirst ? "border-app bg-app-tint text-app" : "border-line bg-panel text-ink-3"}`}
          >
            ★ 즐겨찾기 우선
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl bg-ground py-10 text-center text-sm text-ink-3">이 시간대에 상영이 없어요</div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {groups.map((group) => {
            const slot = timeSlot(group.firstTime);
            const showSlot = slot !== lastSlot;
            lastSlot = slot;
            const eventTypes = [...new Set(group.items.flatMap((item) => item.eventTypes))];
            const eventScreening = group.items.find((item) => item.hasEvent) ?? group.items[0];

            return (
              <div key={group.key}>
                {showSlot && (
                  <div className="flex items-center gap-2 pb-1 pt-1.5 text-xs font-bold tracking-wide text-ink-3">
                    {slot}
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                <div className="grid grid-cols-[5px_42px_1fr] overflow-hidden rounded-[14px] border border-line bg-panel">
                  <div style={{ background: CHAIN_COLOR[group.theater.chain] }} />
                  <Link href={`/movies/${group.movie.id}`} className="block">
                    {group.movie.posterUrl ? (
                      <img
                        src={group.movie.posterUrl.replace("/w500/", "/w200/")}
                        alt={`${group.movie.title} 포스터`}
                        className="h-full w-[42px] object-cover bg-[#dfe4ea]"
                      />
                    ) : (
                      <div className="flex h-full min-h-20 w-[42px] items-center justify-center bg-line-soft text-[15px]">🎞️</div>
                    )}
                  </Link>

                  <div className="min-w-0 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Link href={`/movies/${group.movie.id}`} className="min-w-0 flex-1">
                        <h3 className="truncate text-[14.5px] font-semibold tracking-tight">{group.movie.title}</h3>
                      </Link>
                      <span className="flex-none text-[10.5px] text-ink-3">{group.items.length}회</span>
                    </div>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-2">
                      <span className="h-[7px] w-[7px] rounded-full" style={{ background: CHAIN_COLOR[group.theater.chain] }} />
                      {group.theater.branchName}
                      {favoriteTheaters.has(group.theater.id) && <span className="text-app" aria-label="즐겨찾는 극장">★</span>}
                    </p>

                    <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
                      {group.items.map((screening) => {
                        const status = seatStatus(screening.remainingSeats, screening.totalSeats);
                        const format = formatLabel(screening.format);
                        return (
                          <div
                            key={screening.id}
                            className={`min-w-[58px] flex-none rounded-lg border px-2 py-1 text-center ${status === "soldout" ? "border-line opacity-45" : screening.hasEvent ? "border-goodie-line bg-goodie-tint/60" : "border-line"}`}
                          >
                            <b className={`block text-[13px] tabular-nums ${status === "soldout" ? "line-through" : ""}`}>{screening.startTime}</b>
                            <small className="block truncate text-[8.5px] text-ink-3">{format.label}</small>
                            {screening.remainingSeats !== null && screening.totalSeats !== null && (
                              <small className={`block text-[8.5px] font-semibold ${status === "low" ? "text-low" : status === "soldout" ? "text-soldout" : "text-ink-3"}`}>
                                {status === "soldout" ? "매진" : `${screening.remainingSeats}/${screening.totalSeats}`}
                              </small>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {eventTypes.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="text-[11px]">🎁</span>
                        {eventTypes.slice(0, 2).map((type) => (
                          <button
                            key={type}
                            onClick={() => openPeek(eventScreening, type)}
                            className={`rounded-md border px-1.5 py-px text-[10.5px] font-bold ${GOODIE_BADGE_CLASS}`}
                          >
                            {type === "기타" ? "현장이벤트" : type}
                          </button>
                        ))}
                        {eventTypes.length > 2 && (
                          <button onClick={() => openPeek(eventScreening, null)} className="text-[10.5px] font-semibold text-ink-3">
                            +{eventTypes.length - 2}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {peek && <EventPeek target={peek} onClose={() => setPeek(null)} />}
    </div>
  );
}
