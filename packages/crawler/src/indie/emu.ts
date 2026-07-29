/**
 * 에무시네마 공식 주간 시간표.
 *
 * 공식 홈페이지의 고정 게시물이 매주 화요일 최신 제목·이미지로 갱신된다.
 * 게시물 HTML에서 시간표 이미지만 골라 Gemini 비전 파서로 회차를 구조화한다.
 */

import * as cheerio from "cheerio";
import type { CollectedScreening } from "../domain";
import { noteToFormat, parseTimetable } from "../insta/timetable";

const BASE_URL = "https://www.emuartspace.com";
const SCHEDULE_URL =
  `${BASE_URL}/bbs/m/about_data_view.php` +
  "?ep=ep205032292582d223ceaa81&gp=all&item=ad6632918315896c80e7cbf3&type=about";

export interface EmuSchedulePage {
  caption: string;
  imageUrls: string[];
}

export function parseEmuSchedulePage(html: string): EmuSchedulePage {
  const $ = cheerio.load(html);
  const content = $(".image-container").first();
  const caption = $("meta[property='og:title']").attr("content")?.trim() || $("title").text().trim();
  const imageUrls: string[] = [];

  content.find("img").each((_, image) => {
    // 예매처 로고는 링크 안에 있고, 실제 시간표 이미지는 본문에 직접 삽입된다.
    if ($(image).closest("a").length) return;
    const src = $(image).attr("src")?.trim();
    if (!src) return;
    imageUrls.push(new URL(src, BASE_URL).toString());
  });

  return { caption, imageUrls: [...new Set(imageUrls)] };
}

export async function collectEmuScreenings(): Promise<CollectedScreening[]> {
  const res = await fetch(SCHEDULE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; cinemo/1.0; +https://github.com/mameil/cinemo)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`에무 공식 홈페이지 HTTP ${res.status}`);

  const page = parseEmuSchedulePage(await res.text());
  if (!page.imageUrls.length) throw new Error("에무 시간표 이미지 없음");

  const rows: CollectedScreening[] = [];
  const confidences: number[] = [];
  // 공식 이미지는 1장=1개 상영관 순서로 게시된다. 따로 파싱해야 관 정보가 보존된다.
  for (let index = 0; index < page.imageUrls.length; index++) {
    const timetable = await parseTimetable({
      imageUrls: [page.imageUrls[index]],
      caption: `${page.caption} — ${index + 1}관`,
    });
    if (!timetable.isTimetable || timetable.confidence < 0.7 || !timetable.screenings.length) {
      throw new Error(
        `에무 ${index + 1}관 시간표 저신뢰/빈 결과 (confidence ${timetable.confidence})`
      );
    }
    confidences.push(timetable.confidence);
    rows.push(
      ...timetable.screenings.map((screening) => {
        const isEnglishSubtitles = /eng(?:lish)?\s*sub|영어\s*자막/i.test(screening.note ?? "");
        return {
          chain: "INDIE" as const,
          branchCode: "ig-emuartspace",
          branchName: "에무시네마",
          region: "서울",
          movieTitle: screening.movieTitle,
          playDate: screening.date,
          startTime: screening.time,
          screenName: `${index + 1}관`,
          format: isEnglishSubtitles ? undefined : noteToFormat(screening.note),
          subtitleDub: isEnglishSubtitles ? "영어자막" : undefined,
          bookingUrl: SCHEDULE_URL,
        };
      })
    );
  }
  console.log(
    `  에무 공식 시간표: 이미지 ${page.imageUrls.length}장 · ${rows.length}회차 · confidence ${Math.min(...confidences)}`
  );
  return rows;
}
