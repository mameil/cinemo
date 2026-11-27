/**
 * 로컬 감시 설정 — 감시 하나 = JSON 파일 하나 (~/.cinemo/watch/<이름>.json)
 *
 * 감시 대상(극장·좌석·키워드)은 레포 밖에만 둔다(public 레포). 맥·윈도우 공통 형식이라
 * 어느 PC에서든 같은 실행기(run.ts)가 읽는다. 등록·해제는 agent.ts.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { expandRowsCols } from "./seat-groups";

export const WATCH_HOME = join(homedir(), ".cinemo", "watch");

export type WatchKind = "open" | "event" | "seat";
export const WATCH_KINDS: readonly WatchKind[] = ["open", "event", "seat"];

/** CGV 예매 오픈 — cgv/watch-open.ts checkOpen() */
export interface OpenParams {
  site: string;
  /** "YYYY-MM-DD" 또는 "YYYY-MM-DD..YYYY-MM-DD" */
  date: string;
  movie: string;
  format?: string;
}

/** CGV·메가박스 이벤트 등장 — watch-event.ts checkEvents() */
export interface EventParams {
  match: string;
  chains: string[];
}

/** CGV 특정 회차 지정 좌석 빈자리 */
export interface SeatParams {
  site: string;
  /** YYYYMMDD */
  ymd: string;
  scns: string;
  sseq: string;
  targets: string[];
  /** 상영 시작 YYYYMMDDHHMM — 지나면 조용히 통과 */
  end: string;
  /** 있으면 targets 중 붙어 있는 N자리가 모두 빌 때만 알린다 (seat-groups.ts) */
  adjacent?: number;
}

interface WatchBase {
  name: string;
  intervalSec: number;
  /** 알림 제목에 쓸 이름 (없으면 자동) */
  label?: string;
  /** 이 날짜(YYYYMMDD) 이후엔 조용히 통과 */
  expire?: string;
  /** true 면 판정·상태 저장은 그대로, 폰 푸시만 로그로 대신 (점검용) */
  dry?: boolean;
}

export type WatchConfig =
  | (WatchBase & { kind: "open"; params: OpenParams })
  | (WatchBase & { kind: "event"; params: EventParams })
  | (WatchBase & { kind: "seat"; params: SeatParams });

const NAME_RE = /^[a-z0-9-]+$/;

export function configPath(name: string): string {
  return join(WATCH_HOME, `${name}.json`);
}

/** 감시별 상태 폴더 (알림 횟수·실패 카운트·본 이벤트 등) */
export function stateDir(name: string): string {
  const dir = join(WATCH_HOME, "state", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function assertName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`이름은 소문자·숫자·- 만: ${name}`);
}

function req(kv: Record<string, string>, key: string): string {
  const v = kv[key]?.trim();
  if (!v) throw new Error(`${key} 필요`);
  return v;
}

/** agent add 의 KEY=VALUE 목록 → 설정. 형식 오류는 여기서 막는다. */
export function buildConfig(
  name: string,
  kind: string,
  intervalSec: number,
  kv: Record<string, string>
): WatchConfig {
  assertName(name);
  if (!Number.isInteger(intervalSec) || intervalSec < 60) {
    throw new Error(`주기는 60초 이상 정수: ${intervalSec}`);
  }
  const base = {
    name,
    intervalSec,
    label: kv.label?.trim() || undefined,
    expire: kv.expire?.trim() || undefined,
    dry: kv.dry?.trim() === "1" || undefined,
  };
  if (base.expire && !/^\d{8}$/.test(base.expire)) throw new Error(`expire 는 YYYYMMDD: ${base.expire}`);

  switch (kind) {
    case "open": {
      const date = req(kv, "date");
      if (!/^\d{4}-\d{2}-\d{2}(\.\.\d{4}-\d{2}-\d{2})?$/.test(date)) {
        throw new Error(`date 는 YYYY-MM-DD 또는 YYYY-MM-DD..YYYY-MM-DD: ${date}`);
      }
      return {
        ...base,
        kind,
        params: { site: req(kv, "site"), date, movie: req(kv, "movie"), format: kv.format?.trim() || undefined },
      };
    }
    case "event": {
      const match = req(kv, "match");
      new RegExp(match, "i"); // 정규식 오류면 여기서 던진다
      // 쉼표·공백 모두 구분자 — PowerShell은 따옴표 없는 a,b 를 배열로 보고 "a b"로 넘긴다
      const chains = (kv.chains ?? "cgv,megabox").split(/[\s,]+/).filter(Boolean);
      return { ...base, kind, params: { match, chains } };
    }
    case "seat": {
      const ymd = req(kv, "ymd");
      const end = req(kv, "end");
      if (!/^\d{8}$/.test(ymd)) throw new Error(`ymd 는 YYYYMMDD: ${ymd}`);
      if (!/^\d{12}$/.test(end)) throw new Error(`end 는 YYYYMMDDHHMM: ${end}`);
      // targets='C6 C7' 직접 또는 rows=J,L,M cols=9-19 (둘 다 주면 합친다)
      const listed = (kv.targets ?? "").split(/[\s,]+/).filter(Boolean);
      const grid = kv.rows || kv.cols ? expandRowsCols(kv.rows ?? "", kv.cols ?? "") : [];
      const targets = [...new Set([...listed, ...grid])];
      if (targets.length === 0) throw new Error("targets 또는 rows+cols 필요");
      let adjacent: number | undefined;
      if (kv.adjacent?.trim()) {
        adjacent = Number(kv.adjacent);
        if (!Number.isInteger(adjacent) || adjacent < 2) throw new Error(`adjacent 는 2 이상 정수: ${kv.adjacent}`);
      }
      return {
        ...base,
        kind,
        params: { site: req(kv, "site"), ymd, scns: req(kv, "scns"), sseq: req(kv, "sseq"), targets, end, adjacent },
      };
    }
    default:
      throw new Error(`종류는 ${WATCH_KINDS.join(" | ")}: ${kind}`);
  }
}

export function saveConfig(cfg: WatchConfig): void {
  mkdirSync(WATCH_HOME, { recursive: true });
  writeFileSync(configPath(cfg.name), JSON.stringify(cfg, null, 2) + "\n");
}

export function loadConfig(name: string): WatchConfig {
  assertName(name);
  const path = configPath(name);
  if (!existsSync(path)) throw new Error(`설정 없음: ${path}`);
  const cfg = JSON.parse(readFileSync(path, "utf-8")) as WatchConfig;
  if (cfg.name !== name || !WATCH_KINDS.includes(cfg.kind)) throw new Error(`설정 형식 오류: ${path}`);
  return cfg;
}

export function listConfigs(): WatchConfig[] {
  if (!existsSync(WATCH_HOME)) return [];
  return readdirSync(WATCH_HOME)
    .filter((f) => f.endsWith(".json"))
    .map((f) => loadConfig(f.slice(0, -5)));
}

/** 알림 제목용 이름 */
export function displayLabel(cfg: WatchConfig): string {
  if (cfg.label) return cfg.label;
  switch (cfg.kind) {
    case "open":
      return cfg.params.format ? `${cfg.params.movie} ${cfg.params.format}` : cfg.params.movie;
    case "event":
      return cfg.params.match;
    case "seat": {
      const { ymd, targets, adjacent } = cfg.params;
      const seats = targets.length <= 6 ? targets.join(" ") : `${targets[0]}…${targets.at(-1)} 중`;
      return `${ymd} 좌석 ${seats}${adjacent ? ` 연석${adjacent}` : ""}`;
    }
  }
}
