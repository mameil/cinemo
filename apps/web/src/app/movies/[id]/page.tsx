"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { parseProgramTitle } from "@/lib/program-title";
import { CHAIN_COLOR, GOODIE_BADGE_CLASS, GOODIE_CHIP_CLASS, cleanGoodieName, shortScreenName } from "@/lib/utils";
import { requiredFormat, formatSatisfies } from "@/lib/event-rules";
import { GiftIcon, CalendarIcon, ImageIcon, RefreshIcon } from "@/components/icons";

/** 특전 엔트리 — 종류 + 요구 포맷 + 굿즈 실명 + 재고 (4DX 포스터는 4DX 상영에만) */
interface GoodieEntry {
  type: string;
  fmt: string | null;
  name: string;
  remaining: number | null;
  total: number | null;
  status: string;
}

/** 재고 → 긴급도 라벨 (홈과 동일 규칙) */
function stockQtyLabel(en: GoodieEntry): { text: string; urgent: boolean } {
  if (en.remaining !== null && en.total !== null && en.total > 0) {
    return { text: `${en.remaining}/${en.total}`, urgent: en.remaining / en.total <= 0.1 };
  }
  if (en.remaining !== null) {
    return { text: `잔여 ${en.remaining}`, urgent: en.status === "소량보유" };
  }
  if (en.status === "소량보유") return { text: "소량", urgent: true };
  if (en.status === "보유") return { text: "보유", urgent: false }; // 메가: 수량 미제공, 상태라도 표기
  return { text: "", urgent: false };
}

const CHAIN_CLASS: Record<string, string> = {
  CGV: "bg-cgv",
  LOTTE: "bg-lotte",
  MEGA: "bg-mega",
};

interface StockItem {
  theaterId: number;
  chain: string;
  branchName: string;
  region: string | null;
  status: string;
  remainingQty: number | null;
  totalQty: number | null;
  updatedAt: string;
}

interface GoodieItem {
  id: number;
  name: string;
  type: string;
  imageUrl: string | null;
  stock: StockItem[];
}

interface EventItem {
  id: number;
  chain: string;
  eventName: string;
  startDate: string;
  endDate: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  /** 실물 도안 이미지 (상세 본문) — 있으면 배너 대신 이걸 보여준다 */
  detailImages: string[];
  goodies: GoodieItem[];
}

interface ScreeningItem {
  id: number;
  theaterId: number;
  chain: string;
  branchName: string;
  region: string | null;
  playDate: string;
  startTime: string;
  endTime: string | null;
  screenName: string | null;
  format: string | null;
  remainingSeats: number | null;
  totalSeats: number | null;
  bookingUrl: string | null;
}

interface MovieDetailData {
  id: number;
  title: string;
  posterUrl: string | null;
  releaseDate: string | null;
  events: EventItem[];
  screeningsByDate: Record<string, ScreeningItem[]>;
}

function StockGauge({ stock }: { stock: StockItem[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {stock.map((s) => {
        const hasQty = s.remainingQty !== null && s.totalQty !== null;
        const pct = hasQty ? Math.round((s.remainingQty! / s.totalQty!) * 100) : null;
        const gaugeWidth = pct !== null ? `${pct}%` : s.status === "보유" ? "80%" : s.status === "소량보유" ? "15%" : "0%";
        const gaugeClass = s.status === "소진" ? "bg-soldout" : s.status === "소량보유" ? "bg-low" : "bg-ok";
        const valColor = s.status === "소진" ? "text-soldout" : s.status === "소량보유" ? "text-low" : "text-ok";

        return (
          <div key={s.theaterId} className="grid grid-cols-[96px_1fr_auto] items-center gap-2.5">
            <span className="truncate text-xs text-ink-2">{s.branchName}</span>
            <div className="relative h-2 overflow-hidden rounded-full bg-line-soft">
              <i className={`absolute inset-y-0 left-0 rounded-full ${gaugeClass}`} style={{ width: gaugeWidth }} />
            </div>
            <span className={`min-w-[62px] text-right text-[12px] tabular-nums ${valColor}`}>
              {hasQty ? (
                <>
                  <span className="font-bold">{s.remainingQty}</span>
                  <small className="text-ink-3"> / {s.totalQty}</small>
                </>
              ) : (
                <span className="font-bold">
                  {s.status === "보유" ? "보유" : s.status === "소량보유" ? "소량" : "소진"}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EventCard({ event, dimmed }: { event: EventItem; dimmed?: boolean }) {
  const [showImage, setShowImage] = useState(false);
  const hasApproxNote = event.goodies.some((g) =>
    g.stock.some((s) => s.remainingQty === null)
  );
  const chainLabel = event.chain === "LOTTE" ? "롯데" : event.chain === "MEGA" ? "메가" : event.chain;

  return (
    <div className={`mb-3 rounded-xl border p-3 transition-opacity ${dimmed ? "border-line/60 opacity-55" : "border-line"}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded-[5px] px-1.5 py-0.5 text-[11px] font-bold text-white ${CHAIN_CLASS[event.chain] ?? "bg-ink-3"}`}>
          {chainLabel}
        </span>
        {event.goodies[0] && (
          <button
            onClick={() => setShowImage((v) => !v)}
            className={`rounded-[5px] border px-1.5 py-0.5 text-[11px] font-bold transition-opacity ${GOODIE_BADGE_CLASS} ${showImage ? "opacity-70" : ""}`}
          >
            {event.goodies[0].type === "기타" ? "현장이벤트" : event.goodies[0].type}
            <span className="ml-1 font-normal">{showImage ? "▲" : <><ImageIcon size={11} /> 보기</>}</span>
          </button>
        )}
      </div>
      <p className="text-[12px] text-ink-3">{event.startDate} ~ {event.endDate}</p>
      {showImage && (
        <div className="mt-2 overflow-hidden rounded-lg border border-line-soft">
          {event.detailImages.length > 0 ? (
            event.detailImages.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`${event.eventName} 특전 이미지 ${i + 1}`}
                loading="lazy"
                className="w-full bg-ground object-contain"
              />
            ))
          ) : event.imageUrl ? (
            <>
              <img
                src={event.imageUrl}
                alt={event.eventName}
                loading="lazy"
                className="w-full bg-ground object-contain"
              />
              <p className="border-t border-line-soft bg-ground px-3 py-1.5 text-[11px] text-ink-3">
                ⓘ 홍보 배너 이미지 — 실물 도안 미수집
              </p>
            </>
          ) : (
            <div className="flex items-center justify-center gap-1.5 bg-ground py-5 text-[12px] text-ink-3">
              <ImageIcon size={13} /> {chainLabel} 특전 이미지 미제공
            </div>
          )}
        </div>
      )}
      {!dimmed && event.goodies.map((g) => (
        <div key={g.id} className="mt-2">
          <p className="mb-2 text-[13px] font-semibold">{g.name}</p>
          {g.stock.length > 0 ? (
            <StockGauge stock={g.stock} />
          ) : (
            <p className="text-xs text-ink-3">이 지역에 재고 데이터 없음</p>
          )}
        </div>
      ))}
      {dimmed && (
        <p className="mt-1 text-[12px] font-medium text-ink-2">
          {event.goodies.map((g) => g.type === "기타" ? "현장이벤트" : g.type).join(" · ")}
        </p>
      )}
      {!dimmed && hasApproxNote && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
          ⓘ {chainLabel}는 수량 미제공 — 상태 기준 근사 표시
        </p>
      )}
    </div>
  );
}

function ScreeningSection({
  screeningsByDate,
  theaterGoodieEntries,
  unknownChainEntries,
}: {
  screeningsByDate: Record<string, ScreeningItem[]>;
  /** 극장 id → 특전 엔트리 (재고 기준, 소진 제외) */
  theaterGoodieEntries: Map<number, GoodieEntry[]>;
  /** 지점 데이터 없는 특전의 체인 → 엔트리 (전 지점 미확인 취급) */
  unknownChainEntries: Map<string, GoodieEntry[]>;
}) {
  const dates = Object.keys(screeningsByDate).sort();
  const [activeDate, setActiveDate] = useState(dates[0] ?? "");

  useEffect(() => {
    if (dates.length > 0 && !dates.includes(activeDate)) {
      setActiveDate(dates[0]);
    }
  }, [dates, activeDate]);

  const list = screeningsByDate[activeDate] ?? [];

  // 극장별 그룹
  const byTheater = new Map<string, ScreeningItem[]>();
  for (const s of list) {
    const key = `${s.chain}-${s.branchName}`;
    if (!byTheater.has(key)) byTheater.set(key, []);
    byTheater.get(key)!.push(s);
  }

  return (
    <>
      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
        {dates.map((d, i) => {
          const label = i === 0 ? `오늘 ${d.slice(5)}` : d.slice(5);
          return (
            <button
              key={d}
              onClick={() => setActiveDate(d)}
              className={`flex-none rounded-[10px] border px-3 py-1 text-[13px] whitespace-nowrap ${
                d === activeDate ? "border-ink bg-ink text-ground" : "border-line"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {[...byTheater.entries()].map(([key, items]) => {
        // 이 극장에서 이 영화 보면 받을 수 있는 특전 엔트리 (재고 확인 ∪ 지점 미확인 체인)
        const theaterEntries = [
          ...(theaterGoodieEntries.get(items[0].theaterId) ?? []),
          ...(unknownChainEntries.get(items[0].chain) ?? []),
        ];
        // 극장 헤더 배지: 포맷 무관 전체 종류 (어떤 포맷으로든 받을 수 있는 것들)
        const allTypes = [...new Set(theaterEntries.map((en) => en.type))];
        const typeLabels = allTypes.map((t) => (t === "기타" ? "이벤트" : t));
        const goodieCount = allTypes.length;

        // 상영관(포맷·관)별 그룹 — 관 이름은 줄에 한 번만
        const byScreen = new Map<string, ScreeningItem[]>();
        for (const s of items) {
          const fmt = s.format?.replace(/\s*LASER\s*/i, " ").replace(/\s*2D$/i, "").trim() || "2D";
          const screen = shortScreenName(s.screenName);
          const label = screen ? `${fmt} · ${screen}` : fmt;
          if (!byScreen.has(label)) byScreen.set(label, []);
          byScreen.get(label)!.push(s);
        }
        const screenGroups = [...byScreen.entries()].sort((a, b) =>
          a[1][0].startTime.localeCompare(b[1][0].startTime)
        );

        return (
          <div key={key} className="mb-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: CHAIN_COLOR[items[0].chain as keyof typeof CHAIN_COLOR] }}
              />
              {items[0].branchName}
              {goodieCount > 0 && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-bold ${GOODIE_BADGE_CLASS}`}>
                  <GiftIcon size={10} /> {goodieCount >= 2 ? `${goodieCount}종 · ` : ""}
                  {typeLabels.slice(0, 2).join("·")}
                  {typeLabels.length > 2 && " 외"}
                </span>
              )}
            </div>
            {screenGroups.map(([label, sgItems]) => {
              // 이 상영관(포맷)에서 받을 수 있는 특전만 — 4DX 포스터는 4DX 줄에만 (규칙 ④)
              const sgFormat = sgItems[0].format;
              const sgEntries = theaterEntries.filter((en) => formatSatisfies(en.fmt, sgFormat));
              const seen = new Set<string>();
              const sgItems2 = sgEntries
                .map((en) => ({ name: cleanGoodieName(en.name), ...stockQtyLabel(en) }))
                .filter((it) => {
                  if (!it.name || seen.has(it.name)) return false;
                  seen.add(it.name);
                  return true;
                });
              const sgTypes = sgEntries.map((en) => en.type);

              return (
              <div key={label} className="mb-1.5 pl-3.5 last:mb-0">
                <p className="mb-0.5 text-[10px] font-medium text-ink-3">
                  {label}
                  {sgItems2.length > 0 && (
                    <span className="ml-1 font-semibold text-goodie">
                      <GiftIcon size={10} />{" "}
                      {sgItems2.slice(0, 2).map((it, i) => (
                        <span key={it.name}>
                          {i > 0 && " · "}
                          {it.name}
                          {it.text && (
                            <span className={it.urgent ? "text-low font-bold" : "text-ink-3 font-normal"}>
                              {" "}{it.text}
                            </span>
                          )}
                        </span>
                      ))}
                      {sgItems2.length > 2 && ` 외 ${sgItems2.length - 2}`} 증정
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {sgItems.map((s) => {
                    const soldout = s.remainingSeats === 0;
                    const showGoodie = sgTypes.length > 0 && !soldout;
                    return (
                      <div
                        key={s.id}
                        className={`min-w-[54px] rounded-[9px] border px-2 py-1 text-center ${
                          soldout
                            ? "border-line opacity-45"
                            : showGoodie
                              ? GOODIE_CHIP_CLASS // 특전 받는 상영 — 청록 틴트
                              : "border-line"
                        }`}
                      >
                        <b className={`block text-[13px] tabular-nums ${soldout ? "line-through" : ""}`}>
                          {s.startTime}
                        </b>
                        {s.remainingSeats !== null && s.totalSeats !== null && (
                          <small className={`block text-[10px] tabular-nums ${
                            soldout ? "text-soldout font-bold" : "text-ink-3"
                          }`}>
                            {soldout ? "매진" : `${s.remainingSeats}/${s.totalSeats}`}
                          </small>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        );
      })}

      {list.length === 0 && (
        <p className="py-4 text-center text-xs text-ink-3">이 날짜에 상영 데이터 없음</p>
      )}
    </>
  );
}

export default function MovieDetailPage() {
  const params = useParams();
  const movieId = params.id as string;
  const [detail, setDetail] = useState<MovieDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [today, setToday] = useState("");
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    fetch(`/api/movies/${movieId}`)
      .then((r) => {
        if (r.status === 404) return null; // 없는 영화 — 에러 아님
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setDetail(d))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [movieId, retryTick]);

  useEffect(() => {
    setToday(new Date().toISOString().slice(0, 10));
  }, []);

  const { active, upcoming, past } = useMemo(() => {
    if (!today || !detail) return { active: [] as EventItem[], upcoming: [] as EventItem[], past: [] as EventItem[] };
    const active: EventItem[] = [];
    const upcoming: EventItem[] = [];
    const past: EventItem[] = [];
    for (const e of detail.events) {
      if (e.startDate <= today && e.endDate >= today) active.push(e);
      else if (e.startDate > today) upcoming.push(e);
      else past.push(e);
    }
    return { active, upcoming, past };
  }, [detail?.events, today]);

  const totalActive = active.length + upcoming.length;

  // 상영 칩 특전 표시용 — 극장별 특전 엔트리 {종류, 요구포맷} (재고 기준, 소진 제외)
  const { theaterGoodieEntries, unknownChainEntries } = useMemo(() => {
    const byTheater = new Map<number, GoodieEntry[]>();
    const byChain = new Map<string, GoodieEntry[]>(); // 지점 데이터 없는 이벤트 → 체인 전체 미확인
    const push = (list: GoodieEntry[], en: GoodieEntry) => {
      if (!list.some((x) => x.type === en.type && x.fmt === en.fmt && x.name === en.name)) list.push(en);
    };
    for (const e of active) {
      const fmt = requiredFormat(e.eventName);
      const hasStock = e.goodies.some((g) => g.stock.length > 0);
      if (!hasStock) {
        const list = byChain.get(e.chain) ?? [];
        for (const g of e.goodies)
          push(list, { type: g.type, fmt, name: g.name, remaining: null, total: null, status: "" });
        byChain.set(e.chain, list);
        continue;
      }
      for (const g of e.goodies) {
        for (const s of g.stock) {
          if (s.status === "소진") continue;
          const list = byTheater.get(s.theaterId) ?? [];
          push(list, {
            type: g.type, fmt, name: g.name,
            remaining: s.remainingQty, total: s.totalQty, status: s.status,
          });
          byTheater.set(s.theaterId, list);
        }
      }
    }
    return { theaterGoodieEntries: byTheater, unknownChainEntries: byChain };
  }, [active]);

  if (loading) {
    return (
      <main className="mx-auto max-w-[980px]">
        <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-line bg-panel/95 px-3.5 py-2.5 backdrop-blur-sm">
          <Link href="/movies" className="text-lg">←</Link>
          <b className="text-[15px]">불러오는 중…</b>
        </div>
        <div className="py-20 text-center text-sm text-ink-3">불러오는 중…</div>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="mx-auto max-w-[980px]">
        <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-line bg-panel/95 px-3.5 py-2.5 backdrop-blur-sm">
          <Link href="/movies" className="text-lg">←</Link>
          <b className="text-[15px]">{loadError ? "불러오기 실패" : "영화를 찾을 수 없습니다"}</b>
        </div>
        {loadError && (
          <div className="py-20 text-center text-sm text-ink-3">
            데이터를 불러오지 못했어요 (일시적인 문제일 수 있어요)
            <br />
            <button
              onClick={() => setRetryTick((t) => t + 1)}
              className="mt-3 rounded-full border border-line bg-panel px-4 py-1.5 text-xs font-semibold text-ink-2 hover:border-app hover:text-app transition-colors"
            >
              <RefreshIcon size={12} /> 다시 시도
            </button>
          </div>
        )}
      </main>
    );
  }

  const program = parseProgramTitle(detail.title);

  return (
    <main className="mx-auto max-w-[980px]">
      {/* 상단 네비 */}
      <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-line bg-panel/95 px-3.5 py-2.5 backdrop-blur-sm">
        <Link href="/movies" className="text-lg">←</Link>
        <b className="truncate text-[15px]">{program.title}</b>
      </div>

      {/* 히어로 — 포스터를 은은하게 깐 앰비언트 배경 */}
      <div className="relative overflow-hidden">
        {detail.posterUrl && (
          <>
            <img
              src={detail.posterUrl.replace("/w500/", "/w200/")}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-ground/20 via-ground/60 to-ground" />
          </>
        )}
      <div className="relative flex gap-3.5 px-4 pb-4 pt-4.5">
        {detail.posterUrl ? (
          <img
            src={detail.posterUrl}
            alt={`${detail.title} 포스터`}
            className="h-[154px] w-[104px] flex-none rounded-xl object-cover shadow-md bg-line-soft"
          />
        ) : (
          <div className="flex h-[154px] w-[104px] flex-none items-center justify-center rounded-xl bg-[repeating-linear-gradient(135deg,#1d252c,#1d252c_8px,#161d24_8px,#161d24_16px)] text-xs text-ink-3">
            포스터 없음
          </div>
        )}
        <div>
          <h2 className="mt-1 mb-2 text-[22px] font-[800] tracking-[-0.02em]">{program.title}</h2>
          {program.badges.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {program.badges.map((badge) => (
                <span key={badge} className="rounded-full border border-app/25 bg-app-tint px-2 py-0.5 text-[10px] font-bold text-app">{badge}</span>
              ))}
            </div>
          )}
          {detail.releaseDate && (
            <p className="text-[13px] text-ink-2">개봉 {detail.releaseDate.replace(/-/g, ".")}</p>
          )}
          {totalActive > 0 && (
            <p className="mt-1.5 flex items-center gap-1 text-[13px] font-semibold text-goodie">
              <GiftIcon size={13} /> 특전 {totalActive}건{active.length > 0 ? ` (진행중 ${active.length})` : ""}
            </p>
          )}
        </div>
      </div>
      </div>

      {/* 특전 섹션 — 활성 / 다음 / 지난 분류 */}
      {detail.events.length > 0 && (
        <section className="border-t-8 border-ground px-4 py-4">
          {active.length > 0 && (
            <>
              <div className="mb-3">
                <h4 className="flex items-center gap-1.5 text-[15px] font-bold tracking-tight"><GiftIcon size={15} className="text-goodie" /> 지금 받을 수 있어요</h4>
                <p className="mt-0.5 text-xs text-ink-3">오늘 이 영화를 보면 받는 특전</p>
              </div>
              {active.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </>
          )}

          {upcoming.length > 0 && (
            <>
              <div className={`mb-3 ${active.length > 0 ? "mt-5 border-t border-line-soft pt-4" : ""}`}>
                <h4 className="flex items-center gap-1.5 text-[14px] font-bold tracking-tight text-ink-2"><CalendarIcon size={14} /> 다음 특전</h4>
              </div>
              {upcoming.map((e) => (
                <EventCard key={e.id} event={e} dimmed />
              ))}
            </>
          )}

          {past.length > 0 && (
            <div className="mt-4 border-t border-line-soft pt-3">
              <button
                onClick={() => setShowPast((v) => !v)}
                className="text-[13px] text-ink-3 hover:text-ink-2 transition-colors"
              >
                지난 특전 {past.length}건 {showPast ? "접기 ▲" : "보기 ▼"}
              </button>
              {showPast && (
                <div className="mt-2.5">
                  {past.map((e) => (
                    <EventCard key={e.id} event={e} dimmed />
                  ))}
                </div>
              )}
            </div>
          )}

          {active.length === 0 && upcoming.length === 0 && past.length > 0 && (
            <p className="mb-3 text-[13px] text-ink-3">현재 진행중인 특전이 없습니다</p>
          )}
        </section>
      )}

      {/* 상영 섹션 */}
      {Object.keys(detail.screeningsByDate).length > 0 && (
        <section className="border-t-8 border-ground px-4 py-4">
          <h4 className="mb-3 text-[15px] font-bold tracking-tight">상영 시간표</h4>
          <ScreeningSection
            screeningsByDate={detail.screeningsByDate}
            theaterGoodieEntries={theaterGoodieEntries}
            unknownChainEntries={unknownChainEntries}
          />
        </section>
      )}
    </main>
  );
}
