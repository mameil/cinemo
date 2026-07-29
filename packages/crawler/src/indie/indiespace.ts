/** 인디스페이스 공식 홈페이지의 최신 주간 시간표 이미지. */

import * as cheerio from "cheerio";
import type { CollectedScreening } from "../domain";
import { noteToFormat, parseTimetable } from "../insta/timetable";

const BASE_URL = "https://indiespace.kr";

export function parseIndiespaceHome(html: string): string | undefined {
  const $ = cheerio.load(html);
  const section = $(".cover-event").filter((_, el) => $(el).find("h2").text().includes("상영시간표")).first();
  const links = section.find("a").map((_, el) => $(el).attr("href")).get().filter(Boolean);
  return links.length ? new URL(links[links.length - 1]!, BASE_URL).toString() : undefined;
}

export function parseIndiespaceSchedulePage(html: string): {
  caption: string;
  imageUrl?: string;
} {
  const $ = cheerio.load(html);
  const content = $(".tt_article_useless_p_margin, .contents_style").first();
  return {
    caption: $("meta[property='og:title']").attr("content")?.trim() || $("title").text().trim(),
    imageUrl: content.find("figure img, img").first().attr("src"),
  };
}

export async function collectIndiespaceScreenings(): Promise<CollectedScreening[]> {
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; cinemo/1.0)" };
  const home = await fetch(BASE_URL, { headers, signal: AbortSignal.timeout(30_000) });
  if (!home.ok) throw new Error(`인디스페이스 홈페이지 HTTP ${home.status}`);
  const scheduleUrl = parseIndiespaceHome(await home.text());
  if (!scheduleUrl) throw new Error("인디스페이스 최신 시간표 게시물 없음");
  const post = await fetch(scheduleUrl, { headers, signal: AbortSignal.timeout(30_000) });
  if (!post.ok) throw new Error(`인디스페이스 시간표 HTTP ${post.status}`);
  const page = parseIndiespaceSchedulePage(await post.text());
  if (!page.imageUrl) throw new Error("인디스페이스 시간표 이미지 없음");
  const timetable = await parseTimetable({
    imageUrls: [new URL(page.imageUrl, BASE_URL).toString()],
    caption: page.caption,
  });
  if (!timetable.isTimetable || timetable.confidence < 0.7 || !timetable.screenings.length) {
    throw new Error(`인디스페이스 시간표 저신뢰/빈 결과 (${timetable.confidence})`);
  }
  const rows = timetable.screenings.map((row): CollectedScreening => ({
    chain: "INDIE",
    branchCode: "ig-indiespace_kr",
    branchName: "인디스페이스",
    region: "서울",
    movieTitle: row.movieTitle,
    playDate: row.date,
    startTime: row.time,
    screenName: "상영관",
    format: noteToFormat(row.note),
    bookingUrl: scheduleUrl,
  }));
  console.log(`  인디스페이스 공식 시간표: ${rows.length}회차 · confidence ${timetable.confidence}`);
  return rows;
}
