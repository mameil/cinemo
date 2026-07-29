/**
 * 씨네큐브 광화문 공식 날짜별 시간표.
 *
 * 운영 페이지가 영화명·시작/종료·상영관을 서버 HTML로 제공하므로
 * LLM/OCR 없이 파싱한다. beta 도메인은 회차가 비어 있으므로 www를 사용한다.
 */

import * as cheerio from "cheerio";
import type { CollectedScreening } from "../domain";

const BASE_URL = "https://www.cinecube.co.kr";
const BRANCH_CODE = "ig-cinecube_kr";

export function parseCinecubeTimetable(html: string, requestedDate: string): CollectedScreening[] {
  const $ = cheerio.load(html);
  const result: CollectedScreening[] = [];

  $(".wrap-b6ac47bc > div").each((_, screenEl) => {
    const screenName = $(screenEl).find(".text-383e3cf9").first().text().trim() || "상영관";

    $(screenEl).find("ul.list-ba10942e > li").each((__, rowEl) => {
      const row = $(rowEl);
      const button = row.find("button.reservation-btn").first();
      const playDate = button.attr("data-date")?.trim() || requestedDate;
      const startTime =
        button.attr("data-start-time")?.trim() ||
        row.find(".text-79e5030e").first().text().trim();
      const endTime = row.find(".text-145e97a7").first().text().replace(/^\s*-\s*/, "").trim();
      const rawTitle = row.find(".text-6a9b37c0").first().text().trim();
      // 공식 페이지에 간혹 제목 뒤 줄거리가 붙는 데이터가 있다.
      const movieTitle =
        rawTitle.length > 80 && rawTitle.includes(" : ")
          ? rawTitle.split(" : ", 1)[0].trim()
          : rawTitle;

      if (!movieTitle || !/^\d{4}-\d{2}-\d{2}$/.test(playDate) || !/^\d{2}:\d{2}$/.test(startTime)) {
        return;
      }

      result.push({
        chain: "INDIE",
        branchCode: BRANCH_CODE,
        branchName: "씨네큐브 광화문",
        region: "서울",
        movieTitle,
        playDate,
        startTime,
        endTime: /^\d{2}:\d{2}$/.test(endTime) ? endTime : undefined,
        screenName,
        bookingUrl: `${BASE_URL}/cinema/time-order-table?date=${playDate}`,
      });
    });
  });

  return result;
}

async function fetchDate(date: string): Promise<CollectedScreening[]> {
  const url = `${BASE_URL}/cinema/time-order-table?date=${date}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; cinemo/1.0; +https://github.com/mameil/cinemo)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`씨네큐브 HTTP ${res.status} (${date})`);
  return parseCinecubeTimetable(await res.text(), date);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** 오늘부터 N일간 수집. 사이트 부하를 피하려고 최대 2개 요청만 병렬 실행한다. */
export async function collectCinecubeScreenings(options: {
  days?: number;
  startDate?: string;
} = {}): Promise<CollectedScreening[]> {
  const days = Math.max(1, Math.min(options.days ?? 8, 14));
  const startDate =
    options.startDate ?? new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const dates = Array.from({ length: days }, (_, index) => addDays(startDate, index));
  const result: CollectedScreening[] = [];

  for (let index = 0; index < dates.length; index += 2) {
    const chunk = dates.slice(index, index + 2);
    const rows = await Promise.all(chunk.map(fetchDate));
    result.push(...rows.flat());
  }

  // 미오픈 날짜 요청은 사이트가 가장 가까운 날짜 페이지로 돌려줄 수 있어 중복 제거한다.
  const unique = new Map(
    result.map((row) => [
      `${row.playDate}|${row.startTime}|${row.screenName}|${row.movieTitle}`,
      row,
    ])
  );
  const collected = [...unique.values()];
  console.log(`  씨네큐브 공식 시간표: ${days}일 · ${collected.length}회차`);
  return collected;
}
