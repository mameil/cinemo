/**
 * 이벤트 등장 감시 (키워드) — CGV · 메가박스
 *
 *   CGV: 진행중 이벤트 전체(카테고리 01~06) + 특전(saprm) 목록
 *   메가박스: 진행중 이벤트 전체 탭(CED01 영화 · 02 극장 · 03 메가Pick · 04 무대인사 · 05 제휴/할인)
 *   을 훑어 이름이 키워드 정규식에 맞는 "처음 보는" 이벤트가 생기면 알린다.
 *   예) 체인소 맨 레제편 재개봉 특전 공지가 올라오는 순간 잡기.
 *
 *   pnpm --filter @cinemo/crawler event-watch -- --match='체인소|레제' --state=/path/seen.txt [--chains=cgv,megabox]
 *
 *   본 이벤트 번호는 state 파일에 쌓아두므로 같은 이벤트로 두 번 울리지 않고,
 *   2주차·3주차 특전처럼 새 이벤트가 추가될 때마다 다시 울린다.
 *   첫 실행에 이미 걸리는 이벤트가 있으면 그것도 "새것"으로 알린다(놓치지 않는 쪽).
 *
 *   로컬 상시 감시는 src/watch/run.ts 가 checkEvents()를 직접 불러 ntfy 폰 푸시로 알린다.
 *
 * 종료코드
 *   0 — 새 이벤트 없음
 *   1 — 새 이벤트 감지
 *   2 — 수집 실패(장애) 또는 사용법 오류
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { fetchEventList, fetchSaprmEventList } from "./cgv/api";
import { fetchEventList as fetchMegaboxEventList } from "./megabox/api";

/** CGV 이벤트 카테고리 (01 영화 ~ 06). 진행중 목록 전체를 보려면 다 돌아야 한다. */
const CATEGORIES = ["01", "02", "03", "04", "05", "06"] as const;
/** 메가박스 이벤트 탭. 빈 코드("")는 전체가 아니라 20건만 와서 탭별로 돈다(실측 2026-11-04). */
const MEGABOX_TABS = ["CED01", "CED02", "CED03", "CED04", "CED05"] as const;
/** 메가박스 탭당 요청 건수 — 실측 탭당 40건 미만이라 한 페이지로 충분 */
const MEGABOX_PAGE_SIZE = 300;
const PAGE_SIZE = 50;
/** 카테고리당 최대 페이지 — 무한 루프 방지 (실측 카테고리당 100건 미만) */
const MAX_PAGES = 10;

interface FoundEvent {
  chain: "CGV" | "메가박스";
  /** 상태 파일 키 — 일반 이벤트와 특전 번호 공간이 달라 접두사로 구분 */
  key: string;
  name: string;
  period: string;
}

/** "2026-11-04 00:00:00" → "11/04" · "20261104" → "11/04" */
function md(d: string): string {
  const digits = d.replace(/\D/g, "");
  return digits.length >= 8 ? `${digits.slice(4, 6)}/${digits.slice(6, 8)}` : d;
}

async function collectCgv(match: RegExp): Promise<FoundEvent[]> {
  const found: FoundEvent[] = [];

  for (const cat of CATEGORIES) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const { list } = await fetchEventList(cat, page * PAGE_SIZE, PAGE_SIZE);
      const items = list ?? [];
      for (const e of items) {
        if (match.test(e.evntNm)) {
          found.push({
            chain: "CGV",
            key: `evt:${e.evntNo}`,
            name: e.evntNm,
            period: `${md(e.evntStartDt)}~${md(e.evntEndDt)}`,
          });
        }
      }
      if (items.length < PAGE_SIZE) break;
    }
  }

  const { list: saprm } = await fetchSaprmEventList(0, 200);
  for (const s of saprm ?? []) {
    const name = s.saprmEvntNm || s.evntOnlnExpoNm;
    if (match.test(name) || match.test(s.evntOnlnExpoNm ?? "")) {
      found.push({
        chain: "CGV",
        key: `saprm:${s.saprmEvntNo}`,
        name,
        period: `${md(s.evntStartYmd)}~${md(s.evntEndYmd)}`,
      });
    }
  }
  return found;
}

async function collectMegabox(match: RegExp): Promise<FoundEvent[]> {
  const found: FoundEvent[] = [];
  for (const tab of MEGABOX_TABS) {
    const { list } = await fetchMegaboxEventList(1, MEGABOX_PAGE_SIZE, tab);
    for (const e of list) {
      if (match.test(e.eventTitle)) {
        found.push({
          chain: "메가박스",
          key: `mega:${e.eventNo}`,
          name: e.eventTitle,
          period: `${md(e.startDate)}~${md(e.endDate)}`,
        });
      }
    }
  }
  // 한 이벤트가 여러 탭에 걸쳐 나올 수 있다 — 번호로 중복 제거
  return found.filter((e, i) => found.findIndex((x) => x.key === e.key) === i);
}

type Chain = "cgv" | "megabox";
const COLLECTORS: Record<Chain, (match: RegExp) => Promise<FoundEvent[]>> = {
  cgv: collectCgv,
  megabox: collectMegabox,
};

/** 체인별로 수집 — 한 체인이 실패해도 나머지는 계속 본다. 실패 체인 목록을 함께 돌려준다. */
async function collectEvents(
  match: RegExp,
  chains: Chain[]
): Promise<{ events: FoundEvent[]; failed: Chain[] }> {
  const results = await Promise.allSettled(chains.map((c) => COLLECTORS[c](match)));
  const events = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const failed = chains.filter((_, i) => results[i].status === "rejected");
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`  ✗ ${chains[i]} 수집 실패: ${String(r.reason).slice(0, 200)}`);
  });
  return { events, failed };
}

function readSeen(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  return new Set(
    readFileSync(path, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
  );
}

export interface EventCheckParams {
  /** 이벤트명 정규식 (대소문자 무시) */
  pattern: string;
  /** 본 이벤트 키 누적 파일 */
  statePath: string;
  chains: string[];
}

/**
 * 감시 1회 판정 — CLI(main)와 로컬 실행기(watch/run.ts)가 공유한다.
 *   error  전 체인 수집 실패 · fresh 새 이벤트 · none 없음
 *   failed 일부 체인만 실패한 경우 그 목록 (나머지 체인 결과로 계속 판정)
 * 새 이벤트는 알림 전에 state 파일에 기록한다 — 푸시가 실패해도 매 실행 중복으로 울리지 않게.
 */
export interface EventCheckResult {
  status: "error" | "none" | "fresh";
  failed: string[];
  lines: string[];
}

export async function checkEvents(p: EventCheckParams): Promise<EventCheckResult> {
  const chains = p.chains.map((c) => c.trim()).filter(Boolean);
  const unknown = chains.filter((c) => !(c in COLLECTORS));
  if (unknown.length > 0 || chains.length === 0) {
    throw new Error(`chains 오류: ${unknown.join(",") || "(비어 있음)"} (cgv, megabox 중 선택)`);
  }
  const match = new RegExp(p.pattern, "i"); // 정규식 오류는 그대로 던진다

  const { events, failed } = await collectEvents(match, chains as Chain[]);
  if (failed.length === chains.length) return { status: "error", failed, lines: [] };

  const seen = readSeen(p.statePath);
  const fresh = events.filter((e) => !seen.has(e.key));
  if (fresh.length === 0) return { status: "none", failed, lines: [] };

  const nextSeen = [...seen, ...fresh.map((e) => e.key)];
  writeFileSync(p.statePath, nextSeen.join("\n") + "\n");
  return { status: "fresh", failed, lines: fresh.map((e) => `[${e.chain}] ${e.name} (${e.period})`) };
}

function arg(args: string[], name: string): string | undefined {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found?.slice(name.length + 3);
}

/** CLI — 사람이 직접 돌려 볼 때. 종료코드 0=없음 1=새 이벤트 2=실패 */
async function main(): Promise<number> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const pattern = arg(args, "match");
  const statePath = arg(args, "state");
  const chains = (arg(args, "chains") ?? "cgv,megabox").split(",");
  if (!pattern || !statePath) {
    console.error("사용법: event-watch -- --match='체인소|레제' --state=/path/seen.txt [--chains=cgv,megabox]");
    return 2;
  }
  console.log(`=== 이벤트 감시 /${pattern}/i · ${chains.join(",")} ===`);
  const r = await checkEvents({ pattern, statePath, chains });
  if (r.failed.length > 0) console.log(`실패 체인: ${r.failed.join(",")}`);
  console.log(`→ [${r.status}]`);
  for (const l of r.lines) console.log(`  ★ ${l}`);
  return r.status === "fresh" ? 1 : r.status === "error" ? 2 : 0;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(2);
    }
  );
}
