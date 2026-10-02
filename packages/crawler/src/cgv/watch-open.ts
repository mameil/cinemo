/**
 * CGV 예매 오픈 감시 (특정 극장 × 날짜 × 영화)
 *
 *   searchMovScnInfo를 폴링해 "아직 안 열린 날짜"에 지정 영화 회차가 나타나는 순간을 잡는다.
 *   GitHub Actions 크론이 돌리고, 감지되면 종료코드 1로 잡을 실패시켜
 *   GitHub 기본 실패 알림 메일을 알람으로 쓴다 (워크플로우 이름이 곧 메일 제목).
 *
 *   주의: siteNo=0040(압구정)으로 요청하면 씨네드쉐프 압구정(P001) 회차까지 섞여서 온다.
 *         반드시 응답의 siteNo로 다시 걸러야 한다.
 *
 *   pnpm --filter @cinemo/crawler cgv-watch -- --site=0040 --date=2026-10-09 --movie=사탄탱고
 *
 *   로컬(맥)에서는 scripts/cgv-watch-local.sh 가 이 스크립트를 1분마다 돌리고,
 *   WATCH_OUT / WATCH_SUMMARY 로 결과를 받아 macOS 알림·음성·브라우저로 알린다.
 *
 * 종료코드
 *   0 — 아직 미오픈. 대기 (알람 없음)
 *   1 — 주목 필요 = ⓐ 해당 영화 회차 떴음  또는  ⓑ 날짜는 열렸는데 그 영화가 편성에 없음
 *       (ⓑ도 알리는 이유: 특별전이 끝났다는 뜻이라 다른 날을 노려야 하므로 사람 판단이 필요)
 *   2 — 수집 실패(장애). 알람 마커를 태우지 않도록 1과 구분한다.
 */

import { appendFileSync } from "fs";
import { fetchScreenSchedule, type CgvScnItem } from "./api";

/** 제목 비교용 정규화 — [태그]/(부가정보)/공백·특수문자 제거.
 *  db/movie-match.ts와 같은 규칙이지만 그쪽은 import 시 Turso 클라이언트를 띄우므로
 *  (감시엔 DB가 필요 없고 시크릿도 주고 싶지 않다) 여기서 독립 구현한다. */
function normalizeTitle(title: string): string {
  return title
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^0-9a-z가-힣]/gi, "")
    .toLowerCase();
}

/** "0930" → "09:30" */
function hhmm(t: string): string {
  return /^\d{4}$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : t;
}

/** 오늘(KST) YYYY-MM-DD */
function todayKst(): string {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 회차 조회 — api.ts fetchJson이 이미 3회 재시도하지만, 일시 장애로 알람을 놓치지 않도록
 * 한 겹 더 감싼다(총 3×3회). 끝까지 실패하면 종료코드 2.
 */
async function fetchWithRetry(siteNo: string, ymd: string): Promise<CgvScnItem[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetchScreenSchedule(siteNo, ymd);
    } catch (err) {
      lastErr = err;
      console.error(`  ✗ 조회 실패 (${attempt}/3): ${(err as Error).message}`);
      if (attempt < 3) await sleep(5000 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface WatchOptions {
  /** CGV siteNo (압구정 = 0040) */
  siteNo: string;
  /** 감시 날짜 YYYY-MM-DD */
  date: string;
  /** 영화 제목 (정규화 후 부분일치) */
  movie: string;
}

export interface WatchResult {
  /** 해당 극장의 그 날짜 전체 회차 (영화 무관) */
  siteItems: CgvScnItem[];
  /** 그중 지정 영화 회차 */
  hits: CgvScnItem[];
}

/** 지정 극장·날짜에 해당 영화 회차가 떴는지 확인 */
export async function watchOpen(opts: WatchOptions): Promise<WatchResult> {
  const ymd = opts.date.replace(/-/g, "");
  const key = normalizeTitle(opts.movie);

  const items = await fetchWithRetry(opts.siteNo, ymd);
  // 요청 극장 외(씨네드쉐프 등) 회차가 섞여 오므로 응답 siteNo로 재필터
  const siteItems = items.filter((i) => i.siteNo === opts.siteNo);
  const hits = siteItems.filter((i) => normalizeTitle(i.movNm).includes(key));

  return { siteItems, hits };
}

/** 사람이 읽는 회차 한 줄 */
function formatItem(i: CgvScnItem): string {
  const sub = i.sbtdivNm ? `/${i.sbtdivNm}` : "";
  return `${hhmm(i.scnsrtTm)}~${hhmm(i.scnendTm)} | ${i.scnsNm} | ${i.movNm}(${i.movkndDsplNm}${sub}) | 잔여 ${i.frSeatCnt}/${i.stcnt}`;
}

/**
 * 사람이 읽을 결과 요약(마크다운) 기록.
 *   GITHUB_STEP_SUMMARY — Actions 잡 요약 (실패 메일에서 클릭해 들어오면 바로 보인다)
 *   WATCH_SUMMARY       — 로컬 래퍼(scripts/cgv-watch-local.sh)가 알림 본문으로 쓴다
 */
function writeSummary(lines: string[]): void {
  const body = lines.join("\n") + "\n";
  for (const path of [process.env.GITHUB_STEP_SUMMARY, process.env.WATCH_SUMMARY]) {
    if (path) appendFileSync(path, body);
  }
}

/**
 * key=value 기계용 출력. 호출자가 알람 발송/마커 저장 여부를 이걸로 판단한다.
 *   GITHUB_OUTPUT — Actions 후속 스텝용
 *   WATCH_OUT     — 로컬 래퍼용 (종료코드만으로는 ⓐ/ⓑ 구분이 안 되므로 필요)
 */
function writeOutput(key: string, value: string): void {
  const line = `${key}=${value}\n`;
  for (const path of [process.env.GITHUB_OUTPUT, process.env.WATCH_OUT]) {
    if (path) appendFileSync(path, line);
  }
}

function arg(args: string[], name: string): string | undefined {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found?.slice(name.length + 3);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const siteNo = arg(args, "site") ?? process.env.WATCH_SITE;
  const date = arg(args, "date") ?? process.env.WATCH_DATE;
  const movie = arg(args, "movie") ?? process.env.WATCH_MOVIE;

  if (!siteNo || !date || !movie) {
    console.error(
      "사용법: cgv-watch -- --site=0040 --date=2026-10-09 --movie=사탄탱고\n" +
        "        (환경변수 WATCH_SITE / WATCH_DATE / WATCH_MOVIE 로도 지정 가능)"
    );
    return 2;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`--date 형식 오류: ${date} (YYYY-MM-DD)`);
    return 2;
  }

  const today = todayKst();
  console.log("=== CGV 예매 오픈 감시 ===");
  console.log(`극장 siteNo=${siteNo} · 날짜 ${date} · 영화 "${movie}" · 오늘(KST) ${today}`);

  // 감시 날짜가 지났으면 알람 의미가 없다 — 크론을 못 지운 채로 돌아도 조용히 통과
  if (date < today) {
    console.log("감시 날짜가 이미 지남 → 종료 (크론 제거 권장)");
    writeOutput("alert", "false");
    writeOutput("expired", "true");
    return 0;
  }

  const { siteItems, hits } = await watchOpen({ siteNo, date, movie });
  console.log(`해당 극장 ${date} 회차: ${siteItems.length}건`);

  // ⓐ 영화 감지 — 본래 목적
  if (hits.length > 0) {
    const lines = hits.map(formatItem);
    console.log(`\n★★★ "${movie}" ${date} 예매 오픈 감지 — ${hits.length}회차 ★★★`);
    for (const l of lines) console.log(`  ${l}`);

    writeOutput("alert", "true");
    writeOutput("found", "true");
    writeSummary([
      `## 🎟 "${movie}" ${date} 예매 오픈`,
      "",
      `**${hits[0].siteNm}** · ${hits.length}회차`,
      "",
      ...lines.map((l) => `- ${l}`),
      "",
      "[CGV 바로가기](https://cgv.co.kr)",
    ]);
    return 1;
  }

  // 아직 날짜 자체가 안 열림 — 정상 대기
  if (siteItems.length === 0) {
    console.log(`→ ${date}은 아직 예매 미오픈 (회차 0건). 대기.`);
    writeOutput("alert", "false");
    return 0;
  }

  // ⓑ 날짜는 열렸는데 그 영화가 없음 — 특별전 종료 가능성, 사람 판단 필요
  const titles = [...new Set(siteItems.map((i) => i.movNm))];
  console.log(`\n⚠️  ${date} 예매는 열렸으나 "${movie}" 편성 없음. 편성 목록:`);
  for (const t of titles) console.log(`     - ${t}`);

  writeOutput("alert", "true");
  writeOutput("opened_without_movie", "true");
  writeSummary([
    `## ⚠️ ${date} 예매는 열렸지만 "${movie}" 편성 없음`,
    "",
    `**${siteItems[0].siteNm}** · 총 ${siteItems.length}회차 / ${titles.length}개 작품`,
    "",
    "해당 날짜 편성:",
    "",
    ...titles.map((t) => `- ${t}`),
    "",
    `"${movie}" 를 볼 다른 날짜를 찾아야 합니다.`,
  ]);
  return 1;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("수집 실패:", err);
      writeOutput("alert", "false");
      writeOutput("error", "true");
      process.exit(2);
    });
}
