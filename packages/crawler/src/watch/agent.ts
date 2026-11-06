/**
 * 로컬 감시 등록·해제·목록 — 맥(launchd) · 윈도우(작업 스케줄러) 공통 CLI
 *
 *   pnpm --filter @cinemo/crawler watch-agent -- list
 *   pnpm --filter @cinemo/crawler watch-agent -- add <이름> <open|event|seat> <주기초> key=value ...
 *   pnpm --filter @cinemo/crawler watch-agent -- remove <이름>
 *   pnpm --filter @cinemo/crawler watch-agent -- run <이름>        (스케줄러 없이 1회 실행)
 *   pnpm --filter @cinemo/crawler watch-agent -- test <이름>       (테스트 푸시 1건 — 알림 경로 점검)
 *
 * 예) CGV 영등포 듄 IMAX 예매 오픈 — 2분
 *   add dune-imax open 120 site=0059 date=2026-12-15..2026-12-20 movie=듄 format=IMAX
 * 예) 메가박스 룩백 이벤트 — 5분
 *   add lookback event 300 match='룩백|look ?back' chains=megabox label=룩백 expire=20261201
 * 예) CGV 좌석 — 1분
 *   add hateful8 seat 60 site=0054 ymd=20261105 scns=001 sseq=4 targets='C6 C7' end=202611051715
 *
 * 공통 키: label(알림 제목) · expire(YYYYMMDD 이후 통과)
 * 재등록(add 같은 이름)하면 상태(알림 횟수·본 이벤트)도 초기화된다. 단 --keep-state 면 유지 —
 * 다른 PC에서 옮길 때 ~/.cinemo/watch/state/<이름>/seen.txt 를 먼저 넣고 쓰면 이미 알린 이벤트로 다시 울리지 않는다.
 *
 * 스케줄러가 부르는 것 — 맥: node + tsx 로더로 run.ts 직접 (launchd의 /bin/sh는 macOS TCC 때문에
 * ~/Documents 안 레포를 못 읽는다. node는 허용) · 윈도우: scripts/watch-run.cmd (창 없이 conhost --headless).
 */

import { execFileSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { homedir, platform } from "os";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import {
  buildConfig,
  configPath,
  displayLabel,
  listConfigs,
  loadConfig,
  saveConfig,
  stateDir,
  type WatchConfig,
} from "./config";
import { LOG_PATH } from "./runtime";
import { runWatch, sendTestPush } from "./run";

const REPO_ROOT = resolve(__dirname, "../../../..");
const RUN_TS = join(REPO_ROOT, "packages", "crawler", "src", "watch", "run.ts");
const TSX_LOADER = join(REPO_ROOT, "node_modules", "tsx", "dist", "loader.mjs");
const WIN_LAUNCHER = join(REPO_ROOT, "scripts", "watch-run.cmd");
const IS_MAC = platform() === "darwin";
const IS_WIN = platform() === "win32";

// ── 맥 launchd ───────────────────────────────────

const macLabel = (name: string) => `com.cinemo.watch.${name}`;
const macPlist = (name: string) => join(homedir(), "Library", "LaunchAgents", `${macLabel(name)}.plist`);

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function registerMac(cfg: WatchConfig): void {
  const args = [process.execPath, "--import", pathToFileURL(TSX_LOADER).href, RUN_TS, cfg.name];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>Label</key><string>${macLabel(cfg.name)}</string>
    <key>ProgramArguments</key>
    <array>${args.map((a) => `<string>${xml(a)}</string>`).join("")}</array>
    <key>StartInterval</key><integer>${cfg.intervalSec}</integer>
    <key>RunAtLoad</key><true/>
    <key>StandardOutPath</key><string>/dev/null</string>
    <key>StandardErrorPath</key><string>${xml(join(homedir(), "Library", "Logs", `${macLabel(cfg.name)}.err.log`))}</string>
</dict>
</plist>
`;
  const path = macPlist(cfg.name);
  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  spawnSync("launchctl", ["unload", path], { stdio: "ignore" });
  writeFileSync(path, plist);
  execFileSync("launchctl", ["load", path]);
}

function unregisterMac(name: string): boolean {
  const path = macPlist(name);
  if (!existsSync(path)) return false;
  spawnSync("launchctl", ["unload", path], { stdio: "ignore" });
  unlinkSync(path);
  return true;
}

function macStatus(name: string): string {
  const out = spawnSync("launchctl", ["list"], { encoding: "utf-8" }).stdout ?? "";
  const row = out.split("\n").find((l) => l.endsWith(`\t${macLabel(name)}`));
  if (!row) return "미등록";
  const [pid, code] = row.split("\t");
  return pid === "-" ? `대기 (마지막 종료 ${code})` : `실행 중 (pid ${pid})`;
}

// ── 윈도우 작업 스케줄러 ─────────────────────────

const winTask = (name: string) => `cinemo-watch-${name}`;

function registerWin(cfg: WatchConfig): void {
  if (/\s/.test(WIN_LAUNCHER)) throw new Error(`레포 경로에 공백이 있으면 안 됨: ${WIN_LAUNCHER}`);
  const minutes = Math.max(1, Math.round(cfg.intervalSec / 60));
  // /sc minute 은 등록 시각부터 무기한 반복. 로그온 세션에서 돈다(인스타 배치와 같은 방식).
  execFileSync("schtasks", [
    "/create", "/f",
    "/tn", winTask(cfg.name),
    "/sc", "minute", "/mo", String(minutes),
    "/tr", `conhost.exe --headless ${WIN_LAUNCHER} ${cfg.name}`,
  ], { stdio: "pipe" });
  execFileSync("schtasks", ["/run", "/tn", winTask(cfg.name)], { stdio: "pipe" });
}

function unregisterWin(name: string): boolean {
  const r = spawnSync("schtasks", ["/delete", "/f", "/tn", winTask(name)], { stdio: "pipe" });
  return r.status === 0;
}

function winStatus(name: string): string {
  const r = spawnSync("schtasks", ["/query", "/tn", winTask(name), "/fo", "list", "/v"], { encoding: "utf-8" });
  if (r.status !== 0) return "미등록";
  const pick = (re: RegExp) => (r.stdout.match(re)?.[1] ?? "?").trim();
  // 영문·한글 윈도우 모두 — 필드명이 로캘마다 달라 둘 다 본다
  const status = pick(/^(?:Status|상태):\s*(.+)$/m);
  const last = pick(/^(?:Last Result|마지막 결과):\s*(.+)$/m);
  return `${status} (마지막 결과 ${last})`;
}

// ── 공통 ────────────────────────────────────────

function register(cfg: WatchConfig): void {
  if (IS_MAC) return registerMac(cfg);
  if (IS_WIN) return registerWin(cfg);
  throw new Error(`지원하지 않는 OS: ${platform()} (설정만 저장됨 — run 으로 수동 실행 가능)`);
}

function unregister(name: string): boolean {
  if (IS_MAC) return unregisterMac(name);
  if (IS_WIN) return unregisterWin(name);
  return false;
}

function status(name: string): string {
  if (IS_MAC) return macStatus(name);
  if (IS_WIN) return winStatus(name);
  return "?";
}

/** 로그에서 해당 감시의 마지막 줄 */
function lastLogLine(name: string): string {
  if (!existsSync(LOG_PATH)) return "";
  const tag = `[${name}] `;
  const lines = readFileSync(LOG_PATH, "utf-8").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(tag)) return lines[i];
  }
  return "";
}

function parseKv(pairs: string[]): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i <= 0) throw new Error(`key=value 형식이 아님: ${p}`);
    kv[p.slice(0, i).trim()] = p.slice(i + 1);
  }
  return kv;
}

function cmdAdd(args: string[]): void {
  // --keep-state: 상태 폴더를 미리 채워둔 경우(다른 PC에서 옮겨온 seen.txt 등) 지우지 않는다
  const keepState = args.includes("--keep-state");
  const [name, kind, interval, ...pairs] = args.filter((a) => a !== "--keep-state");
  if (!name || !kind || !interval) throw new Error("사용법: add <이름> <open|event|seat> <주기초> key=value ... [--keep-state]");
  const cfg = buildConfig(name, kind, Number(interval), parseKv(pairs));
  saveConfig(cfg);
  if (!keepState) rmSync(stateDir(name), { recursive: true, force: true }); // 재등록 = 상태 초기화
  register(cfg);
  console.log(`등록: ${name} (${cfg.kind}, ${cfg.intervalSec}초) — ${displayLabel(cfg)}`);
  console.log(`  설정 ${configPath(name)}`);
  console.log(`  로그 ${LOG_PATH}`);
}

function cmdRemove(args: string[]): void {
  const [name] = args;
  if (!name) throw new Error("사용법: remove <이름>");
  const wasRegistered = unregister(name);
  const path = configPath(name);
  const hadConfig = existsSync(path);
  if (hadConfig) unlinkSync(path);
  rmSync(stateDir(name), { recursive: true, force: true });
  if (!wasRegistered && !hadConfig) throw new Error(`없음: ${name}`);
  console.log(`해제: ${name}`);
}

function cmdList(): void {
  const configs = listConfigs();
  if (configs.length === 0) {
    console.log("등록된 감시 없음");
    return;
  }
  for (const cfg of configs) {
    console.log(`● ${cfg.name}  [${cfg.kind} · ${cfg.intervalSec}초${cfg.expire ? ` · ~${cfg.expire}` : ""}]  ${displayLabel(cfg)}`);
    console.log(`    스케줄러: ${status(cfg.name)}`);
    const last = lastLogLine(cfg.name);
    if (last) console.log(`    최근: ${last}`);
  }
  console.log(`\n로그: ${LOG_PATH}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const [sub, ...rest] = args;
  switch (sub) {
    case "add":
      return cmdAdd(rest);
    case "remove":
      return cmdRemove(rest);
    case "list":
      return cmdList();
    case "run":
      if (!rest[0]) throw new Error("사용법: run <이름>");
      loadConfig(rest[0]); // 없으면 여기서 에러
      return runWatch(rest[0]);
    case "test":
      if (!rest[0]) throw new Error("사용법: test <이름>");
      return sendTestPush(rest[0]);
    default:
      console.error("사용법: watch-agent -- <list | add | remove | run | test> ... (src/watch/agent.ts 머리 주석 참고)");
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(`오류: ${(err as Error).message}`);
  process.exit(1);
});
