/**
 * 로컬 감시 실행기 — 스케줄러(맥 launchd · 윈도우 작업 스케줄러)가 주기마다 1회 실행
 *
 *   node --import <repo>/node_modules/tsx/dist/loader.mjs packages/crawler/src/watch/run.ts <이름>
 *   (직접 돌려보기: pnpm --filter @cinemo/crawler watch-agent -- run <이름>)
 *
 * 설정은 ~/.cinemo/watch/<이름>.json (config.ts), 등록은 agent.ts.
 * 감시 결과는 로그(runtime.ts LOG_PATH)에 남기고, 알릴 것만 ntfy 폰 푸시로 보낸다.
 *
 * 실패 처리: 한두 번의 순단은 흔하다(Cloudflare 순간 차단 등). 연속 실패가 FAIL_ALERT_AFTER회
 * 이어질 때만 1회 알리고, 복구되면 복구 알림을 1회 보낸다. 결과를 못 낸 실행은 전부 실패로 센다 —
 * 죽은 감시를 "대기"로 오인하는 게 가장 나쁜 실패이기 때문.
 */

import { config as loadDotenv } from "dotenv";
import { join, resolve } from "path";
import { fetchSeatMap } from "../cgv/api";
import { checkOpen } from "../cgv/watch-open";
import { checkEvents } from "../watch-event";
import { displayLabel, loadConfig, stateDir, type WatchConfig } from "./config";
import {
  applyCaBundle,
  makeLogger,
  nowKst,
  ntfyTopic,
  pushNtfy,
  readCount,
  readText,
  removeFile,
  writeText,
} from "./runtime";

const REPO_ROOT = resolve(__dirname, "../../../..");
/** 같은 건(예매 오픈)으로 몇 번까지 알릴지 — 1회면 놓쳤을 때 복구가 안 되고, 무제한이면 평생 울린다 */
const MAX_ALERTS = 5;
/** 연속 실패 몇 번째에 장애 알림을 보낼지 (종류별 주기가 달라 대략 10~30분) */
const FAIL_ALERT_AFTER: Record<WatchConfig["kind"], number> = { open: 5, event: 6, seat: 5 };
const CGV_URL = "https://cgv.co.kr";
const MEGABOX_EVENT_URL = "https://www.megabox.co.kr/event";

type Log = (msg: string) => void;

interface Ctx {
  cfg: WatchConfig;
  label: string;
  dir: string;
  log: Log;
  push: (title: string, message: string, priority: number, click?: string) => Promise<void>;
}

function makePush(kind: string, log: Log): Ctx["push"] {
  return async (title, message, priority, click = CGV_URL) => {
    const topic = ntfyTopic(kind);
    if (!topic) {
      log("  ntfy 토픽 없음(~/.cinemo/ntfy-topic) — 푸시 생략");
      return;
    }
    try {
      const code = await pushNtfy({ topic, title, message, priority, click, tags: [kind] });
      log(`  ntfy HTTP ${code}`);
    } catch (err) {
      log(`  ntfy 실패: ${(err as Error).message}`);
    }
  };
}

/** 연속 실패 추적 — key 별로 센다 (이벤트 감시는 체인별) */
async function trackFailure(ctx: Ctx, key: string, isFailed: boolean, detail: string): Promise<void> {
  const countFile = join(ctx.dir, `fail-count-${key}`);
  const markFile = join(ctx.dir, `fail-alerted-${key}`);
  if (!isFailed) {
    removeFile(countFile);
    if (readText(markFile) !== "") {
      removeFile(markFile);
      await ctx.push(`✅ ${ctx.label} 감시 복구`, "다시 정상 동작합니다.", 2);
    }
    return;
  }
  const n = readCount(countFile) + 1;
  writeText(countFile, String(n));
  ctx.log(`실패${key === "all" ? "" : `(${key})`} ${n}회 연속: ${detail}`);
  if (n >= FAIL_ALERT_AFTER[ctx.cfg.kind] && readText(markFile) === "") {
    writeText(markFile, "1");
    await ctx.push(`⚠️ ${ctx.label} 감시 실패`, `${n}회 연속 실패 중${key === "all" ? "" : ` (${key})`}. PC 로그 확인: ${detail}`.slice(0, 300), 3);
  }
}

async function runOpen(ctx: Ctx & { cfg: Extract<WatchConfig, { kind: "open" }> }): Promise<void> {
  const p = ctx.cfg.params;
  const r = await checkOpen({ siteNo: p.site, dateSpec: p.date, movie: p.movie, format: p.format });
  await trackFailure(ctx, "all", false, "");

  if (r.status === "expired" || r.status === "wait") {
    ctx.log(`대기 — ${r.headline}`);
    return;
  }
  const countFile = join(ctx.dir, "alert-count");
  const count = readCount(countFile);
  if (count >= MAX_ALERTS) {
    ctx.log(`알림 ${count}회 완료 — 통과 (다시 받으려면 재등록)`);
    return;
  }
  writeText(countFile, String(count + 1));

  const isFound = r.status === "found";
  const title = isFound ? `🎟 ${ctx.label} 예매 오픈!` : `⚠️ ${r.headline}`;
  const body = [r.siteName, ...r.lines.slice(0, 3)].filter(Boolean).join("\n");
  ctx.log(`★ 알림 ${count + 1}/${MAX_ALERTS} — ${title}\n${r.lines.map((l) => `    ${l}`).join("\n")}`);
  await ctx.push(title, body || r.headline, isFound ? 5 : 4);
}

async function runEvent(ctx: Ctx & { cfg: Extract<WatchConfig, { kind: "event" }> }): Promise<void> {
  const p = ctx.cfg.params;
  const r = await checkEvents({ pattern: p.match, statePath: join(ctx.dir, "seen.txt"), chains: p.chains });

  if (r.status === "error") throw new Error(`전 체인 수집 실패 (${r.failed.join(",")})`);
  await trackFailure(ctx, "all", false, "");
  for (const chain of p.chains) {
    await trackFailure(ctx, chain, r.failed.includes(chain), `${chain} 수집 실패`);
  }

  if (r.status === "none") {
    ctx.log(`대기 — 새 이벤트 없음`);
    return;
  }
  const body = r.lines.join("\n");
  ctx.log(`★ 새 이벤트 감지:\n${r.lines.map((l) => `    ${l}`).join("\n")}`);
  const click = body.includes("[CGV]") ? CGV_URL : MEGABOX_EVENT_URL;
  await ctx.push(`🎁 ${ctx.label} 이벤트 등장`, body, 5, click);
}

async function runSeat(ctx: Ctx & { cfg: Extract<WatchConfig, { kind: "seat" }> }): Promise<void> {
  const p = ctx.cfg.params;
  if (nowKst().ymdhm >= p.end) {
    ctx.log("상영 시작 지남 — 통과 (해제 권장)");
    return;
  }
  const seats = await fetchSeatMap(p.site, p.ymd, p.scns, p.sseq);
  const id = (s: { seatRowNm: string; seatNo: string }) => s.seatRowNm + s.seatNo;
  const missing = p.targets.filter((t) => !seats.some((s) => id(s) === t));
  if (missing.length > 0) throw new Error(`대상 좌석이 응답에 없음: ${missing.join(" ")}`);
  await trackFailure(ctx, "all", false, "");

  const avail = seats
    .filter((s) => p.targets.includes(id(s)) && s.seatSaleYn === "Y")
    .map(id)
    .sort();
  const lastFile = join(ctx.dir, "last-avail");
  const prev = readText(lastFile).split(" ").filter(Boolean);
  writeText(lastFile, avail.join(" "));

  // 직전엔 없었는데 새로 빈 좌석만 알린다 — 같은 자리로 매번 울리지 않게
  const fresh = avail.filter((s) => !prev.includes(s));
  if (fresh.length === 0) {
    ctx.log(`대기 — 빈 좌석: ${avail.join(" ") || "없음"}`);
    return;
  }
  ctx.log(`★ 새로 빈 좌석: ${fresh.join(" ")}`);
  await ctx.push(`🎟 좌석 났다: ${fresh.join(" ")}`, `${ctx.label} · 지금 빈 자리: ${avail.join(" ")}`, 5);
}

async function runOnce(ctx: Ctx): Promise<void> {
  switch (ctx.cfg.kind) {
    case "open":
      return runOpen(ctx as Parameters<typeof runOpen>[0]);
    case "event":
      return runEvent(ctx as Parameters<typeof runEvent>[0]);
    case "seat":
      return runSeat(ctx as Parameters<typeof runSeat>[0]);
  }
}

export async function runWatch(name: string): Promise<void> {
  loadDotenv({ path: join(REPO_ROOT, ".env"), quiet: true }); // CURL_IMPERSONATE_BIN 등
  applyCaBundle();

  const cfg = loadConfig(name);
  const log = makeLogger(name);
  const ctx: Ctx = { cfg, label: displayLabel(cfg), dir: stateDir(name), log, push: makePush(cfg.kind, log) };

  if (cfg.expire && nowKst().ymd >= cfg.expire) {
    log(`감시 기한(${cfg.expire}) 지남 — 통과 (해제 권장)`);
    return;
  }
  try {
    await runOnce(ctx);
  } catch (err) {
    await trackFailure(ctx, "all", true, describeError(err));
  }
}

/** 알림·로그용 짧은 실패 사유 — execSync 에러는 curl 명령 전체(서명 헤더 포함)를 메시지에 담으므로 잘라낸다 */
function describeError(err: unknown): string {
  const e = err as Error & { status?: number; code?: string };
  if (e.message?.startsWith("Command failed")) {
    const host = e.message.match(/https?:\/\/([^/'\s]+)/)?.[1] ?? "?";
    return `${host} 조회 실패 (curl exit ${e.status ?? e.code ?? "?"})`;
  }
  return (e.message ?? String(err)).split("\n")[0].slice(0, 200);
}

if (require.main === module) {
  const name = process.argv.slice(2).find((a) => a !== "--");
  if (!name) {
    console.error("사용법: run.ts <감시 이름>");
    process.exit(2);
  }
  runWatch(name).then(
    () => process.exit(0),
    (err) => {
      // 설정 오류 등 — 로그 파일에도 남겨야 스케줄러 실행에서 보인다
      try {
        makeLogger(name)(`실행 불가: ${(err as Error).message}`);
      } catch {
        console.error(err);
      }
      process.exit(2);
    }
  );
}
