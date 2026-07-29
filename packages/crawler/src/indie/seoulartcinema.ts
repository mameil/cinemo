/** 서울아트시네마 공식 홈페이지의 서버 렌더링 시간표 표. */

import * as cheerio from "cheerio";
import type { CollectedScreening } from "../domain";

const SCHEDULE_URL = "https://www.cinematheque.seoul.kr/bbs/content.php?co_id=timetable";

function resolveYear(month: number, now = new Date(Date.now() + 9 * 3600e3)): number {
  const year = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (currentMonth >= 11 && month <= 2) return year + 1;
  if (currentMonth <= 2 && month >= 11) return year - 1;
  return year;
}

export function parseSeoulArtCinemaTimetable(html: string): CollectedScreening[] {
  const $ = cheerio.load(html);
  const result: CollectedScreening[] = [];
  let dates: string[] = [];

  $("#ctt_con table tr").each((_, rowEl) => {
    const row = $(rowEl);
    if (row.hasClass("date-label")) {
      dates = row.find("td").map((__, cell) => {
        const match = $(cell).text().trim().match(/(\d{2})\.(\d{2})/);
        if (!match) return "";
        const month = Number(match[1]);
        return `${resolveYear(month)}-${match[1]}-${match[2]}`;
      }).get();
      return;
    }
    if (!row.hasClass("event")) return;
    row.find("td").each((index, cell) => {
      const link = $(cell).find("a").first();
      const startTime = link.find("strong").first().text().trim();
      const titleNode = link.find("p").eq(1).clone();
      titleNode.find("span").remove();
      const movieTitle = titleNode.text().trim();
      const runtime = link.text().match(/\((\d+)\s*min\)/i);
      const playDate = dates[index];
      if (!playDate || !movieTitle || !/^\d{2}:\d{2}$/.test(startTime)) return;
      let endTime: string | undefined;
      if (runtime) {
        const total = Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3)) + Number(runtime[1]);
        endTime = `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
      }
      result.push({
        chain: "INDIE",
        branchCode: "ig-seoulartcinema",
        branchName: "서울아트시네마",
        region: "서울",
        movieTitle,
        playDate,
        startTime,
        endTime,
        screenName: "상영관",
        bookingUrl: link.attr("href") || SCHEDULE_URL,
      });
    });
  });
  return result;
}

export async function collectSeoulArtCinemaScreenings(options: {
  days?: number;
  startDate?: string;
} = {}): Promise<CollectedScreening[]> {
  const res = await fetch(SCHEDULE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; cinemo/1.0)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`서울아트시네마 HTTP ${res.status}`);
  const parsed = parseSeoulArtCinemaTimetable(await res.text());
  const days = Math.max(1, Math.min(options.days ?? 8, 14));
  const startDate =
    options.startDate ?? new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const end = new Date(`${startDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  const endDate = end.toISOString().slice(0, 10);
  const rows = parsed.filter((row) => row.playDate >= startDate && row.playDate < endDate);
  if (!parsed.length) throw new Error("서울아트시네마 공식 시간표가 비어 있음");
  console.log(`  서울아트시네마 공식 시간표: ${days}일 · ${rows.length}회차`);
  return rows;
}
