"use client";

import { useState } from "react";
import type { ScreeningCard, EventPreview } from "@mock/types";
import { CHAIN_COLOR, GOODIE_BADGE_CLASS, seatStatus, formatLabel, timeSlot } from "@/lib/utils";
import EventPeek, { type PeekTarget } from "@/components/EventPeek";
import Link from "next/link";

export default function TimelineView({
  screenings,
  eventPreviews = {},
}: {
  screenings: ScreeningCard[];
  eventPreviews?: Record<string, EventPreview[]>;
}) {
  const sorted = [...screenings].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const [peek, setPeek] = useState<PeekTarget | null>(null);

  // 배지 클릭 → 카드 링크 이동 대신 미리보기 모달 (이 극장이 진행 극장인 이벤트만)
  const openPeek = (e: React.MouseEvent, s: ScreeningCard, type: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    const previews = (eventPreviews[`${s.movie.id}-${s.theater.chain}`] ?? []).filter(
      (p) => p.theaterIds.length === 0 || p.theaterIds.includes(s.theater.id)
    );
    setPeek({
      movieTitle: s.movie.title,
      type,
      theaterName: s.theater.branchName,
      entries: [{ chain: s.theater.chain, previews }],
    });
  };

  let lastSlot = "";

  return (
    <div className="flex flex-col gap-2.5 p-3">
      {sorted.map((s) => {
        const slot = timeSlot(s.startTime);
        const showSlot = slot !== lastSlot;
        lastSlot = slot;

        const status = seatStatus(s.remainingSeats, s.totalSeats);
        const fmt = formatLabel(s.format);

        return (
          <div key={s.id}>
            {showSlot && (
              <div className="flex items-center gap-2 pb-1 pt-1.5 text-xs font-bold tracking-wide text-ink-3">
                {slot}
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
            <Link
              href={`/movies/${s.movie.id}`}
              className="grid grid-cols-[5px_42px_1fr] overflow-hidden rounded-[14px] border border-line bg-panel transition-transform hover:-translate-y-px hover:shadow-md"
            >
              {/* 체인 바 */}
              <div style={{ background: CHAIN_COLOR[s.theater.chain] }} />

              {/* 포스터 썸네일 */}
              {s.movie.posterUrl ? (
                <img
                  src={s.movie.posterUrl.replace("/w500/", "/w200/")}
                  alt=""
                  className="h-full w-[42px] self-stretch object-cover bg-[#dfe4ea]"
                />
              ) : (
                <div className="flex w-[42px] items-center justify-center bg-[repeating-linear-gradient(135deg,#e7ebf0,#e7ebf0_6px,#eef1f5_6px,#eef1f5_12px)] text-[15px] text-[#aab1bb]">
                  🎞️
                </div>
              )}

              <div className="min-w-0 px-3 py-2.5">
                {/* 1줄: 시간 + 제목 + 좌석 */}
                <div className="flex items-baseline gap-2">
                  <span className="text-[15px] font-extrabold tracking-tight tabular-nums">
                    {s.startTime}
                  </span>
                  <h3 className="min-w-0 flex-1 truncate text-[14.5px] font-semibold tracking-tight">
                    {s.movie.title}
                  </h3>
                  {s.remainingSeats !== null && s.totalSeats !== null && (
                    <span
                      className={`flex-none text-[12.5px] font-bold tabular-nums ${
                        status === "soldout"
                          ? "text-soldout"
                          : status === "low"
                            ? "text-low"
                            : "text-ink-2"
                      }`}
                    >
                      {s.remainingSeats}
                      <small className="text-[10.5px] font-medium">
                        /{s.totalSeats}
                        {status === "low" && " · 임박"}
                        {status === "soldout" && " · 매진"}
                      </small>
                    </span>
                  )}
                </div>

                {/* 2줄: 포맷 · 지점 · 종료시간 */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-[5px] px-1.5 py-0.5 text-[10.5px] font-bold ${
                      fmt.variant === "imax"
                        ? "bg-[#e5f0fb] text-[#0b5cad]"
                        : fmt.variant === "premium"
                          ? "bg-[#f2e9fa] text-[#6d2e9e]"
                          : "bg-line-soft text-ink-2"
                    }`}
                  >
                    {fmt.label}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                    <span
                      className="h-[7px] w-[7px] rounded-full"
                      style={{ background: CHAIN_COLOR[s.theater.chain] }}
                    />
                    {s.theater.branchName}
                  </span>
                  {s.endTime && (
                    <span className="text-[11px] tabular-nums text-ink-3">
                      ~{s.endTime}
                      {s.subtitleDub && ` · ${s.subtitleDub}`}
                    </span>
                  )}
                </div>

                {/* 3줄: 특전 배지 */}
                {s.hasEvent && s.eventTypes.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="text-[11px]">🎁</span>
                    {s.eventTypes.slice(0, 2).map((t) => (
                      <button
                        key={t}
                        onClick={(e) => openPeek(e, s, t)}
                        className={`rounded-md border px-1.5 py-px text-[10.5px] font-bold transition-colors cursor-pointer ${GOODIE_BADGE_CLASS}`}
                      >
                        {t === "기타" ? "현장이벤트" : t}
                      </button>
                    ))}
                    {s.eventTypes.length > 2 && (
                      <button
                        onClick={(e) => openPeek(e, s, null)}
                        className="text-[10.5px] font-semibold text-ink-3 hover:text-app"
                      >
                        +{s.eventTypes.length - 2}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </Link>
          </div>
        );
      })}
      {peek && <EventPeek target={peek} onClose={() => setPeek(null)} />}
    </div>
  );
}
