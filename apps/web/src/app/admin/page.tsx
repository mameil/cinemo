"use client";

import { useCallback, useEffect, useState } from "react";

interface Run {
  source: string;
  machine: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  events: number | null;
  screenings: number | null;
  detail: string | null;
  pending?: boolean; // 이 기계에 실행 요청 대기 중
}
interface Totals {
  indieEvents: number;
  indieScreenings: number;
  lastCollectedAt: string | null;
}
interface RunRequest {
  source: string;
  requestedAt: string | null;
  pending: boolean;
}
interface Payload {
  runs: Run[];
  summary: Run[];
  totals: Totals;
  request?: RunRequest;
}

const SOURCE_LABEL: Record<string, string> = {
  "insta-local": "인스타(로컬)",
  "insta-apify": "인스타(클라우드)",
  goods: "굿즈·특전",
  showtime: "상영시간표",
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;

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
const shortMachine = (m: string) => m.replace(/\.(local|[a-z]+\.co\.kr)$/, "");

export default function AdminPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const [requesting, setRequesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 어드민 쓰기: x-admin-secret 헤더(로컬 저장) 첨부. 401이면 비밀번호 물어보고 재시도.
  async function adminPost(url: string, payload: unknown): Promise<Response> {
    const send = (secret: string) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { "x-admin-secret": secret } : {}),
        },
        body: JSON.stringify(payload),
      });
    let res = await send(localStorage.getItem("adminSecret") ?? "");
    if (res.status === 401) {
      const entered = window.prompt("관리 비밀번호 (ADMIN_SECRET)") ?? "";
      if (entered) {
        localStorage.setItem("adminSecret", entered);
        res = await send(entered);
      }
    }
    return res;
  }

  async function dispatchCloud(target: string, label: string) {
    setMsg(`${label} 실행 요청 중…`);
    try {
      const res = await adminPost("/api/admin/dispatch", { target });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(res.ok ? `✅ ${label} 실행됨 — GitHub Actions에서 진행` : `❌ ${label}: ${j.error ?? res.status}`);
    } catch {
      setMsg(`❌ ${label} 실행 요청 실패`);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/batch-runs", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Payload);
      setRefreshedAt(new Date().toISOString());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  async function requestRun(machine?: string) {
    if (requesting) return;
    setRequesting(true);
    try {
      await adminPost("/api/admin/request-run", { source: "insta-local", machine });
      await load();
    } catch {
      /* 무시 — 다음 새로고침에 반영 */
    } finally {
      setRequesting(false);
    }
  }

  useEffect(() => {
    document.title = "배치 현황 · cinemo admin";
    load();
    const t = setInterval(load, 30_000); // 30초 자동 새로고침
    return () => clearInterval(t);
  }, [load]);

  const runs = data?.runs ?? [];
  const summary = data?.summary ?? [];
  const totals = data?.totals;
  const request = data?.request;
  const errorCount = runs.filter((r) => r.status === "error").length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-ink">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-lg font-extrabold tracking-tight">배치 현황</h1>
        <span className="text-[11px] text-ink-3">로컬 인스타 · 굿즈 · 상영 크론</span>
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] font-semibold text-ink-2 hover:text-app disabled:opacity-50"
        >
          <span className={loading ? "inline-block animate-spin" : ""}>↻</span> 새로고침
        </button>
      </div>

      {refreshedAt && (
        <p className="mb-3 text-[10.5px] text-ink-3">
          {stamp(refreshedAt)} 기준 · 30초마다 자동 갱신
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-soldout/10 px-3 py-2 text-[12px] text-soldout">
          불러오기 실패 — 새로고침을 눌러주세요.
        </p>
      )}

      {/* 누적 수집량 */}
      {totals && (
        <div className="mb-4 rounded-xl border border-line bg-app-tint/40 px-4 py-3">
          <div className="text-[11px] font-semibold text-app">수집 누적 (독립관)</div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <span>이벤트 <b>{totals.indieEvents}</b></span>
            <span>상영 <b>{totals.indieScreenings}</b>회차</span>
            {totals.lastCollectedAt && (
              <span className="text-ink-3">마지막 신규 수집 {ago(totals.lastCollectedAt)}</span>
            )}
          </div>
        </div>
      )}

      {/* 로컬 배치 수동 실행 (요청 플래그 → 각 PC 폴러가 5분 내 처리) */}
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-ink">인스타 로컬 수집 · 수동 실행</div>
          <div className="text-[10.5px] text-ink-3">
            {request?.pending
              ? `요청됨 ${request.requestedAt ? ago(request.requestedAt) : ""} · 각 PC 폴러가 5분 내 수집`
              : "누르면 각 PC(집·회사)가 5분 내 수집을 시작합니다"}
          </div>
        </div>
        <button
          onClick={() => requestRun()}
          disabled={requesting || request?.pending}
          className={`ml-auto flex-none rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50 ${
            request?.pending
              ? "border-app bg-app-tint text-app"
              : "border-line bg-panel text-ink-2 hover:border-app hover:text-app"
          }`}
        >
          {request?.pending ? "⏳ 전체 대기 중" : requesting ? "요청 중…" : "▶ 전체 실행"}
        </button>
      </div>

      {/* 클라우드 배치 수동 실행 (GitHub Actions workflow_dispatch) */}
      <div className="mb-4 rounded-xl border border-line bg-white px-3 py-2.5">
        <div className="text-[12.5px] font-semibold text-ink">클라우드 배치 · 수동 실행</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {[
            { t: "showtime", l: "상영시간표" },
            { t: "goods", l: "체인 굿즈" },
            { t: "insta-apify", l: "인스타(Apify)" },
          ].map((b) => (
            <button
              key={b.t}
              onClick={() => dispatchCloud(b.t, b.l)}
              className="rounded-full border border-line bg-panel px-3 py-1.5 text-[12px] font-semibold text-ink-2 hover:border-app hover:text-app transition-colors"
            >
              ▶ {b.l}
            </button>
          ))}
        </div>
        <div className="mt-1.5 text-[10.5px] text-ink-3">
          {msg ?? "GitHub Actions를 즉시 실행합니다 (진행은 Actions 탭·아래 최신 상태에서)"}
        </div>
      </div>

      {/* 소스/기계별 최신 상태 */}
      <h2 className="mb-2 text-[12px] font-bold text-ink-2">소스별 최신 상태</h2>
      <div className="mb-5 grid gap-2 sm:grid-cols-2">
        {summary.map((r, i) => (
          <div
            key={i}
            className={`rounded-xl border px-3 py-2.5 ${
              r.status === "success" ? "border-line bg-white" : "border-soldout/40 bg-soldout/5"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 flex-none rounded-full ${
                  r.status === "success" ? "bg-ok" : "bg-soldout"
                }`}
              />
              <span className="text-[13px] font-semibold">{sourceLabel(r.source)}</span>
              {r.source === "insta-local" && (
                <span className="text-[11px] font-normal text-ink-3">{shortMachine(r.machine)}</span>
              )}
              <span className="ml-auto text-[10.5px] text-ink-3">{ago(r.startedAt)}</span>
              {/* insta-local 기계별 개별 재실행 */}
              {r.source === "insta-local" && (
                <button
                  onClick={() => requestRun(r.machine)}
                  disabled={requesting || r.pending}
                  className={`flex-none rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                    r.pending
                      ? "border-app bg-app-tint text-app"
                      : "border-line bg-panel text-ink-2 hover:border-app hover:text-app"
                  }`}
                >
                  {r.pending ? "⏳ 대기" : "↻ 재실행"}
                </button>
              )}
            </div>
            <div
              className={`mt-1 truncate text-[11.5px] ${
                r.status === "success" ? "text-ink-3" : "text-soldout"
              }`}
              title={r.detail ?? ""}
            >
              {r.status === "success" ? r.detail ?? "정상" : `실패 · ${r.detail ?? ""}`}
            </div>
          </div>
        ))}
        {!loading && summary.length === 0 && !error && (
          <p className="text-[12px] text-ink-3">아직 실행 기록이 없습니다.</p>
        )}
      </div>

      {/* 최근 실행 로그 */}
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[12px] font-bold text-ink-2">최근 실행</h2>
        {runs.length > 0 && (
          <span className="text-[10.5px] text-ink-3">
            최근 {runs.length}회 중 <b className={errorCount ? "text-soldout" : "text-ok"}>실패 {errorCount}</b>
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-[11.5px]">
          <thead className="bg-ground/60 text-ink-3">
            <tr>
              <th className="px-2.5 py-1.5 text-left font-semibold">시각</th>
              <th className="px-2.5 py-1.5 text-left font-semibold">소스</th>
              <th className="px-2.5 py-1.5 text-left font-semibold">기계</th>
              <th className="px-2.5 py-1.5 text-left font-semibold">결과</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={i} className={`border-t border-line-soft ${r.status === "error" ? "bg-soldout/5" : ""}`}>
                <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums text-ink-3">{stamp(r.startedAt)}</td>
                <td className="whitespace-nowrap px-2.5 py-1.5">{sourceLabel(r.source)}</td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-ink-3">{shortMachine(r.machine)}</td>
                <td className="px-2.5 py-1.5">
                  <span className="mr-1">{r.status === "success" ? "✅" : "❌"}</span>
                  <span className={r.status === "error" ? "text-soldout" : "text-ink-2"} title={r.detail ?? ""}>
                    {r.detail ?? r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[10.5px] text-ink-3">
        상영은 공식 예매처(Dtryx·MOVIEE 등)에서, 인스타 로컬은 굿즈·소식만 수집합니다.
      </p>
    </main>
  );
}
