/**
 * CGV 예매 오픈 감시 (특정 극장 × 날짜 × 영화)
 *
 *   searchMovScnInfo를 폴링해 "아직 안 열린 날짜"에 지정 영화 회차가 나타나는 순간을 잡는다.
 *   (GitHub Actions 크론 경로는 지연·폐기가 심해 2026-10 폐기 — 로컬 감시가 담당)
 *
 *   주의: siteNo=0040(압구정)으로 요청하면 씨네드쉐프 압구정(P001) 회차까지 섞여서 온다.
 *         반드시 응답의 siteNo로 다시 걸러야 한다.
 *
 *   pnpm --filter @cinemo/crawler cgv-watch -- --site=0040 --date=2026-10-09 --movie=사탄탱고
 *   pnpm --filter @cinemo/crawler cgv-watch -- --site=0059 --date=2026-12-15..2026-12-20 --movie=듄 --format=IMAX
 *
 *   --date=A..B  날짜 범위(양끝 포함, 지난 날짜는 건너뜀). 범위 중 하나라도 회차가 뜨면 알람.
 *   --format=X   상영 포맷(movkndDsplNm) 부분일치 필터 — "IMAX관"에서 일반 2D를 트는 경우가 있어
 *                (예: "최종면접(non-IMAX)") 관 이름이 아니라 포맷으로 판별한다.
 *   범위·포맷 중 하나라도 지정하면 ⓑ(날짜는 열렸는데 영화 없음) 알람은 끈다 —
 *   대형 극장은 날짜만 열리면 다른 영화로 차서 매번 오탐이 나기 때문. ⓐ만 알린다.
 *
 *   로컬 상시 감시는 src/watch/run.ts 가 checkOpen()을 직접 불러 ntfy 폰 푸시로 알린다
 *   (등록: pnpm --filter @cinemo/crawler watch-agent -- add ...).
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

/** "A" 또는 "A..B" → [A..B] 날짜 목록 (YYYY-MM-DD, 양끝 포함). 형식 오류면 null */
const MAX_RANGE_DAYS = 14; // 1회 실행 요청 수 상한 — Cloudflare 차단 회피
function expandDates(spec: string): string[] | null {
  const [from, to = from] = spec.split("..");
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to) || to < from) return null;
  const dates: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); ; d = new Date(d.getTime() + 864e5)) {
    const ymd = d.toISOString().slice(0, 10);
    if (ymd > to) break;
    dates.push(ymd);
    if (dates.length > MAX_RANGE_DAYS) return null;
  }
  return dates;
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
  /** 상영 포맷 부분일치 (예: IMAX). 없으면 포맷 무관 */
  format?: string;
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
  const fmt = opts.format?.toLowerCase();
  const hits = siteItems.filter(
    (i) =>
      normalizeTitle(i.movNm).includes(key) &&
      (!fmt || (i.movkndDsplNm ?? "").toLowerCase().includes(fmt))
  );

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
 *   WATCH_SUMMARY       — CLI 호출자가 결과 본문을 받아 쓸 때
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
 *   WATCH_OUT     — CLI 호출자용 (종료코드만으로는 ⓐ/ⓑ 구분이 안 되므로 필요)
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

export interface OpenCheckParams {
  siteNo: string;
  /** "YYYY-MM-DD" 또는 "YYYY-MM-DD..YYYY-MM-DD" */
  dateSpec: string;
  movie: string;
  format?: string;
}

/**
 * 감시 1회 판정 결과 — CLI(main)와 로컬 실행기(watch/run.ts)가 공유한다.
 *   expired              감시 날짜가 전부 지남
 *   wait                 아직 미오픈
 *   found                ⓐ 해당 영화(·포맷) 회차 등장
 *   opened_without_movie ⓑ 날짜는 열렸는데 영화 없음 (단일 날짜·포맷 미지정 모드에서만)
 * 수집 실패는 예외로 던진다.
 */
export interface OpenCheckResult {
  status: "expired" | "wait" | "found" | "opened_without_movie";
  /** "듄 IMAX" 처럼 영화+포맷 */
  label: string;
  /** 알림 한 줄 요약 */
  headline: string;
  /** 회차(ⓐ) 또는 편성 작품(ⓑ) 목록 */
  lines: string[];
  siteName?: string;
}

const md = (ymd: string): string => `${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`;

export async function checkOpen(p: OpenCheckParams): Promise<OpenCheckResult> {
  const allDates = expandDates(p.dateSpec);
  if (!allDates) {
    throw new Error(
      `날짜 형식 오류: ${p.dateSpec} (YYYY-MM-DD 또는 YYYY-MM-DD..YYYY-MM-DD, 최대 ${MAX_RANGE_DAYS}일)`
    );
  }
  const format = p.format?.trim() || undefined;
  const label = format ? `${p.movie} ${format}` : p.movie;

  // 감시 날짜가 전부 지났으면 알람 의미가 없다 — 등록을 못 지운 채로 돌아도 조용히 통과
  const dates = allDates.filter((d) => d >= todayKst());
  if (dates.length === 0) {
    return { status: "expired", label, headline: "감시 날짜가 이미 지남", lines: [] };
  }

  const hits: CgvScnItem[] = [];
  const openDates: string[] = [];
  let lastSiteItems: CgvScnItem[] = [];
  for (const date of dates) {
    const r = await watchOpen({ siteNo: p.siteNo, date, movie: p.movie, format });
    if (r.siteItems.length > 0) openDates.push(date);
    lastSiteItems = r.siteItems;
    hits.push(...r.hits);
    if (dates.length > 1) await sleep(300); // 연속 요청 간격 — Cloudflare 순간 차단 회피
  }

  // ⓐ 영화 감지 — 본래 목적
  if (hits.length > 0) {
    const hitDates = [...new Set(hits.map((i) => md(i.scnYmd)))].join("·");
    return {
      status: "found",
      label,
      headline: `${hitDates} ${hits.length}회차`,
      lines: hits.map((i) => `${md(i.scnYmd)} ${formatItem(i)}`),
      siteName: hits[0].siteNm,
    };
  }

  // ⓑ는 단일 날짜·포맷 미지정 모드에서만 (대형 극장 범위·포맷 감시는 매번 오탐 — 파일 머리 주석)
  const isSimpleMode = allDates.length === 1 && !format;
  if (!isSimpleMode || openDates.length === 0) {
    const range = dates.length > 1 ? `${dates[0]}..${dates[dates.length - 1]}` : dates[0];
    const opened = openDates.length ? `열린 날짜 ${openDates.join(", ")}` : "열린 날짜 없음";
    return { status: "wait", label, headline: `${range} 미오픈 (${opened})`, lines: [] };
  }

  const titles = [...new Set(lastSiteItems.map((i) => i.movNm.trim()))];
  return {
    status: "opened_without_movie",
    label,
    headline: `${dates[0]} 예매는 열렸지만 "${p.movie}" 편성 없음`,
    lines: titles,
    siteName: lastSiteItems[0].siteNm,
  };
}

/** CLI — 사람이 직접 돌려 볼 때. 종료코드 0=대기 1=주목 2=실패 */
async function main(): Promise<number> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const siteNo = arg(args, "site") ?? process.env.WATCH_SITE;
  const dateSpec = arg(args, "date") ?? process.env.WATCH_DATE;
  const movie = arg(args, "movie") ?? process.env.WATCH_MOVIE;
  const format = arg(args, "format") ?? process.env.WATCH_FORMAT;

  if (!siteNo || !dateSpec || !movie) {
    console.error(
      "사용법: cgv-watch -- --site=0040 --date=2026-10-09 --movie=사탄탱고 [--format=IMAX]\n" +
        "        --date=2026-12-15..2026-12-20 처럼 범위도 가능"
    );
    return 2;
  }

  console.log("=== CGV 예매 오픈 감시 ===");
  console.log(`극장 siteNo=${siteNo} · 날짜 ${dateSpec} · 영화 "${movie}${format ? " " + format : ""}" · 오늘(KST) ${todayKst()}`);
  const r = await checkOpen({ siteNo, dateSpec, movie, format });
  console.log(`→ [${r.status}] ${r.headline}`);
  for (const l of r.lines) console.log(`  ${l}`);

  writeOutput("alert", String(r.status === "found" || r.status === "opened_without_movie"));
  if (r.status === "expired") writeOutput("expired", "true");
  if (r.status === "found") writeOutput("found", "true");
  if (r.status === "opened_without_movie") writeOutput("opened_without_movie", "true");
  if (r.lines.length > 0) {
    writeSummary([`## ${r.label} — ${r.headline}`, "", `**${r.siteName ?? ""}**`, "", ...r.lines.map((l) => `- ${l}`)]);
  }
  return r.status === "found" || r.status === "opened_without_movie" ? 1 : 0;
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
