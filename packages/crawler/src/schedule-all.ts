/**
 * 상영시간표 수집 오케스트레이터 (롯데 + 메가 + CGV + 독립영화관)
 *
 * 굿즈 크롤(index.ts)과 분리된 별도 잡. 상영시간표는 무겁고 하루 1회면 충분해서
 * 전용 크론(schedule.yml)에서 실행한다.
 *
 *   pnpm --filter @cinemo/crawler schedule                 # 구역 기본(SCHEDULE_ONLY) 8일
 *   pnpm --filter @cinemo/crawler schedule -- --days=8 --only=일산,고양,...
 *   pnpm --filter @cinemo/crawler schedule -- --all        # 수도권 전체 (무거움)
 *
 * 실패가 하나라도 있으면 exit 1 → GitHub Actions 실패 알림.
 */

import { appendFileSync } from "fs";
import { collectLotteScreenings } from "./lotte/schedule";
import { collectMegaboxScreenings } from "./megabox/schedule";
import { collectCgvScreenings } from "./cgv/schedule";
import { collectIndieScreenings } from "./indie/schedule";
import { ingestScreenings, deletePastScreenings, recordCrawlRun } from "./db/repo";
import type { Chain, CollectedScreening } from "./domain";

/** 오늘(KST) YYYY-MM-DD */
function kstToday(): string {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

// 기본 수집 구역 (일산·서울 서부·부천 등). --all 이면 무시하고 수도권 전체.
// 체인마다 지점명이 달라 부분일치 키워드로 넓게 잡는다 (롯데 일산=라페스타 등).
const DEFAULT_ZONE = [
  "일산", "라페스타", "고양", "파주", "김포", "부천", "소풍", "피카디리",
  "용산", "영등포", "구로", "신촌", "홍대", "연남", "등촌", "대학로",
  "은평", "합정", "신도림", "목동", "마곡", "상암", "이수", "더부티크",
];

interface Stage {
  chain: Chain;
  label: string;
  collect: (o: { days?: number; only?: string[] }) => Promise<CollectedScreening[]>;
}

const STAGES: Stage[] = [
  { chain: "LOTTE", label: "롯데 상영", collect: collectLotteScreenings },
  { chain: "MEGA", label: "메가 상영", collect: collectMegaboxScreenings },
  { chain: "CGV", label: "CGV 상영", collect: collectCgvScreenings },
  { chain: "INDIE", label: "독립관 공식 상영", collect: collectIndieScreenings },
];

function writeJobSummary(lines: string[], failed: number): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const md = [
    `## 상영시간표 수집 — ${failed === 0 ? "✅ 성공" : `❌ 실패 ${failed}건`}`,
    ``,
    `| 상태 | 단계 | 상세 |`,
    `|---|---|---|`,
    ...lines,
    ``,
  ].join("\n");
  try {
    appendFileSync(path, md);
  } catch {
    /* 요약 실패는 무시 */
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const all = args.includes("--all");
  const daysArg = args.find((a) => a.startsWith("--days="));
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const days = daysArg ? Number(daysArg.split("=")[1]) : 8;

  // 구역: --all이면 전체, --only 있으면 그 값, 없으면 env SCHEDULE_ONLY, 그것도 없으면 DEFAULT_ZONE
  let only: string[] | undefined;
  if (all) only = undefined;
  else if (onlyArg) only = onlyArg.split("=")[1].split(",").filter(Boolean);
  else if (process.env.SCHEDULE_ONLY)
    only = process.env.SCHEDULE_ONLY.split(",").map((s) => s.trim()).filter(Boolean);
  else only = DEFAULT_ZONE;

  console.log("========== 상영시간표 수집 시작 ==========");
  console.log(all ? "범위: 수도권 전체" : `범위: 구역(${only!.length}개 키워드) · ${days}일`);

  const startedAt = new Date().toISOString();
  const summaryLines: string[] = [];
  const failures: string[] = [];
  let totalScreenings = 0;

  for (const st of STAGES) {
    console.log(`\n--- ${st.label} ---`);
    try {
      const collected = await st.collect({ days, only });
      const stats = await ingestScreenings(st.chain, collected);
      totalScreenings += stats.screenings;
      const skipNote = stats.skipped > 0 ? ` / ⚠️ 스킵 ${stats.skipped}` : "";
      const detail = `상영 ${stats.screenings} / 지점 ${stats.theaters} / 영화 ${stats.moviesLinked}${skipNote}`;
      console.log(`  ✅ ${st.label}: ${detail}`);
      summaryLines.push(`| ${stats.skipped > 0 ? "⚠️" : "✅"} | ${st.label} | ${detail} |`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ ${st.label} 실패: ${msg}`);
      summaryLines.push(`| ❌ | ${st.label} | ${msg.slice(0, 200)} |`);
      failures.push(st.label);
    }
  }

  // 지난 날짜 상영 정리 (오늘 이전)
  try {
    const removed = await deletePastScreenings(kstToday());
    console.log(`\n지난 상영 정리: ${removed}건 삭제 (< ${kstToday()})`);
  } catch (err) {
    console.error("  ⚠️ 지난 상영 정리 실패:", (err as Error).message);
  }

  console.log("\n========== 완료 ==========");
  writeJobSummary(summaryLines, failures.length);

  await recordCrawlRun({
    source: "showtime",
    startedAt,
    status: failures.length === 0 ? "success" : "error",
    screenings: totalScreenings,
    detail:
      failures.length === 0
        ? `상영 ${totalScreenings}회차 (${STAGES.length}사)`
        : `실패: ${failures.join(", ")}`,
  });

  return failures.length === 0;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
