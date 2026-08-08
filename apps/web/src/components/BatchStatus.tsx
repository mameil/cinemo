"use client";

import { useState } from "react";

interface Run {
  source: string;
  machine: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  events: number | null;
  screenings: number | null;
  detail: string | null;
}

function ago(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

function stamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const SOURCE_LABEL: Record<string, string> = {
  "insta-local": "인스타(로컬)",
  "insta-apify": "인스타(클라우드)",
  goods: "굿즈/특전",
  showtime: "상영시간표",
};
function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] ?? s;
}

/** 로컬 배치(두 PC) 실행 상태 — 헤더 버튼 → 드롭다운. crawl_runs를 /api/batch-runs로 조회. */
interface Totals {
  indieEvents: number;
  indieScreenings: number;
  lastCollectedAt: string | null;
}

export default function BatchStatus() {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [summary, setSummary] = useState<Run[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/batch-runs");
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { runs: Run[]; summary: Run[]; totals: Totals };
      setRuns(j.runs);
      setSummary(j.summary);
      setTotals(j.totals);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) load(); // 열 때마다 새로고침
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold transition-colors ${
          open
            ? "border-app bg-app-tint text-app"
            : "border-line bg-panel text-ink-3 hover:text-app"
        }`}
      >
        ◷ 배치
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-[min(340px,86vw)] rounded-xl border border-line bg-white p-3 text-left shadow-lg">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[12px] font-bold text-ink">로컬 배치 상태</span>
            <button
              onClick={load}
              disabled={loading}
              className="ml-auto text-[11px] text-ink-3 hover:text-app disabled:opacity-50"
            >
              <span className={loading ? "inline-block animate-spin" : ""}>↻</span> 새로고침
            </button>
          </div>

          {loading && runs === null && (
            <p className="py-4 text-center text-[12px] text-ink-3">불러오는 중…</p>
          )}
          {error && (
            <p className="py-4 text-center text-[12px] text-soldout">불러오기 실패 — 다시 시도</p>
          )}

          {runs !== null && !error && runs.length === 0 && (
            <p className="py-4 text-center text-[12px] text-ink-3">
              아직 실행 기록이 없습니다. (각 PC가 최신 코드로 한 번 돌면 표시됩니다)
            </p>
          )}

          {/* 누적 수집량 — per-run 0("신규 없음")이 "비어있음"으로 오해되지 않게 */}
          {totals && (
            <div className="mb-2 rounded-lg bg-app-tint/50 px-2.5 py-1.5 text-[11px] text-ink-2">
              <span className="font-semibold text-app">수집 누적</span> · 이벤트{" "}
              {totals.indieEvents} · 상영 {totals.indieScreenings}회차
              {totals.lastCollectedAt && (
                <span className="text-ink-3"> · 마지막 신규 {ago(totals.lastCollectedAt)}</span>
              )}
            </div>
          )}

          {runs !== null && runs.length > 0 && (
            <>
              {/* 소스별 최신 요약 (인스타-로컬은 PC별, 굿즈·상영은 소스별) */}
              <div className="space-y-1.5">
                {summary.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg border border-line bg-ground/50 px-2.5 py-1.5"
                  >
                    <span
                      className={`h-2 w-2 flex-none rounded-full ${
                        r.status === "success" ? "bg-ok" : "bg-soldout"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-ink">
                        {sourceLabel(r.source)}
                        {r.source === "insta-local" && (
                          <span className="font-normal text-ink-3">
                            {" · "}
                            {r.machine.replace(/\.(local|[a-z]+\.co\.kr)$/, "")}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[10.5px] text-ink-3">
                        {ago(r.startedAt)} ·{" "}
                        {r.status === "success" ? r.detail ?? "정상" : "❗ 실패"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* 최근 실행 로그 */}
              <div className="mt-2.5 border-t border-line-soft pt-2">
                <div className="mb-1 text-[10.5px] font-semibold text-ink-3">최근 실행</div>
                <div className="max-h-52 space-y-1 overflow-y-auto">
                  {runs.map((r, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[11px] leading-tight">
                      <span
                        className={`mt-[3px] h-1.5 w-1.5 flex-none rounded-full ${
                          r.status === "success" ? "bg-ok" : "bg-soldout"
                        }`}
                      />
                      <span className="flex-none tabular-nums text-ink-3">{stamp(r.startedAt)}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-2" title={`${r.machine} · ${r.detail ?? ""}`}>
                        {sourceLabel(r.source)} · {r.detail ?? r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
