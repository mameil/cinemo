/**
 * 크롤러 오케스트레이터 (전체 파이프라인)
 *
 *   pnpm crawl                       # 3사 수집·적재 → KOBIS 백필 → TMDB 포스터
 *   pnpm crawl -- --max=5            # 각 체인 최대 5건 (빠른 점검용)
 *   pnpm crawl -- --skip-backfill    # 수집·적재만, 백필 생략
 *
 * 순서가 중요하다:
 *   1) 체인 수집·적재 (events/goodies/stock/theaters/movies 생성)
 *   2) KOBIS 백필 (movies.kobis_code / release_date)
 *   3) TMDB 포스터 (movies.tmdb_id / poster_url)
 *
 * 한 단계가 실패해도 나머지는 계속 진행하되(에러 격리), 실패가 하나라도 있으면
 * 마지막에 exit 1로 끝낸다 → GitHub Actions가 "실패"로 표시하고 알림을 보냄.
 * 단계별 결과는 GitHub Job Summary($GITHUB_STEP_SUMMARY)에도 기록한다.
 */

import { appendFileSync } from "fs";
import { collectCgv } from "./cgv/collect";
import { collectLotte } from "./lotte/collect";
import { collectMegabox } from "./megabox/collect";
import { ingest } from "./db/repo";
import { backfill } from "./kobis-backfill";
import { syncMovies } from "./tmdb-sync";
import type { Chain, CollectedEvent } from "./domain";

interface ChainDef {
  chain: Chain;
  label: string;
  collect: (opts: { maxEvents?: number; skipGeneral?: boolean }) => Promise<CollectedEvent[]>;
}

const CHAINS: ChainDef[] = [
  { chain: "CGV", label: "CGV", collect: collectCgv },
  { chain: "LOTTE", label: "롯데시네마", collect: collectLotte },
  { chain: "MEGA", label: "메가박스", collect: collectMegabox },
];

/** 단계별 실행 결과 */
interface StageResult {
  stage: string;
  ok: boolean;
  detail: string;
}

/**
 * 에러 메시지를 요약용으로 축약한다.
 * execSync 에러는 "Command failed: <긴 명령>\n<stderr>" 형태라, 명령 덤프는 빼고
 * 실제 원인만 남긴 뒤 길이를 제한한다.
 */
function shortError(msg: string): string {
  const lines = msg
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const useful = lines.filter((l) => !l.startsWith("Command failed:"));
  const text = (useful.length ? useful : lines).join(" · ");
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/**
 * 안전 실행: 성공/실패를 StageResult로 반환 (예외를 삼키지 않고 기록).
 * 일시적 실패(타임아웃 등)가 잦아 단계 전체를 1회 재시도한다 — 수집·적재는
 * 모두 upsert(멱등)라 재실행 안전. (2026-07-17)
 */
async function runStage(
  stage: string,
  fn: () => Promise<string>,
  attempts = 2
): Promise<StageResult> {
  console.log(`\n--- ${stage} ---`);
  let lastMsg = "";
  for (let i = 1; i <= attempts; i++) {
    try {
      const detail = await fn();
      const retried = i > 1 ? " (재시도 성공)" : "";
      console.log(`  ✅ ${stage}: ${detail}${retried}`);
      return { stage, ok: true, detail: detail + retried };
    } catch (err) {
      lastMsg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ ${stage} 실패 (${i}/${attempts}): ${lastMsg}`); // 로그엔 전체
      if (i < attempts) {
        console.log(`  ↻ 15초 후 재시도…`);
        await new Promise((r) => setTimeout(r, 15_000));
      }
    }
  }
  return { stage, ok: false, detail: shortError(lastMsg) }; // 요약엔 축약
}

/** 단계별 결과를 GitHub Job Summary(마크다운)로 기록 */
function writeJobSummary(results: StageResult[], failed: number): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;

  const now = new Date().toISOString();
  const rows = results
    .map((r) => `| ${r.ok ? "✅" : "❌"} | ${r.stage} | ${r.detail} |`)
    .join("\n");
  const md = [
    `## 크롤 결과 — ${failed === 0 ? "✅ 성공" : `❌ 실패 ${failed}건`}`,
    ``,
    `실행 시각(UTC): ${now}`,
    ``,
    `| 상태 | 단계 | 상세 |`,
    `|---|---|---|`,
    rows,
    ``,
  ].join("\n");

  try {
    appendFileSync(path, md);
  } catch {
    /* 요약 기록 실패는 파이프라인 성패에 영향 없음 */
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const maxArg = args.find((a) => a.startsWith("--max="));
  const maxEvents = maxArg ? Number(maxArg.split("=")[1]) : undefined;
  const skipBackfill = args.includes("--skip-backfill");
  // 3h 크론용: 일반 이벤트(무대인사·제휴 등) 수집 생략 — 특전+재고만.
  // 일반 이벤트는 하루 2회 풀 크롤에서 수집 (2026-07-19 크론 15분 타임아웃 대응)
  const skipGeneral = args.includes("--skip-general");

  console.log("========== cinemo 크롤 파이프라인 시작 ==========");
  if (maxEvents) console.log(`(각 체인 최대 ${maxEvents}건)`);
  if (skipGeneral) console.log("(일반 이벤트 수집 생략 — 특전+재고만)");

  const results: StageResult[] = [];

  // 1) 체인별 수집 → 적재
  for (const def of CHAINS) {
    results.push(
      await runStage(`${def.label} 수집·적재`, async () => {
        const collected = await def.collect({ maxEvents, skipGeneral });
        const s = await ingest(def.chain, collected);
        const skipNote = s.skipped > 0 ? ` / ⚠️ 스킵 ${s.skipped}` : "";
        return `이벤트 ${s.events} / 굿즈 ${s.goodies} / 소진 ${s.stock} / 지점 ${s.theaters} / 영화연결 ${s.moviesLinked}${skipNote}`;
      })
    );
  }

  // 2) KOBIS 백필 + 3) TMDB 포스터
  if (!skipBackfill) {
    results.push(
      await runStage("KOBIS 백필", async () => {
        await backfill(false);
        return "완료";
      })
    );
    results.push(
      await runStage("TMDB 포스터", async () => {
        await syncMovies();
        return "완료";
      })
    );
  }

  // 요약
  const failedResults = results.filter((r) => !r.ok);
  const failed = failedResults.length;

  console.log("\n========== 파이프라인 완료 ==========");
  for (const r of results) {
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.stage}: ${r.detail}`);
  }
  if (failed > 0) {
    console.log(`\n⚠️  실패 ${failed}건: ${failedResults.map((r) => r.stage).join(", ")}`);
  }

  writeJobSummary(results, failed);

  // 실패가 하나라도 있으면 비정상 종료 → GitHub Actions 실패 처리 + 알림
  return failed === 0;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
