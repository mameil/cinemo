/**
 * 동명 영화 판별 (KOBIS 후보 2개 이상일 때)
 *
 * 배경(2026-07-24): 라이카가 상영하는 "부기나이트"(1997, PTA)가
 * 2022년 한국 동명 영화로 오매칭 — 제목만으로는 판단 불가한 케이스.
 *
 * 판별 계층:
 *   ① 체인(CGV/롯데/메가) 상영작 → 기존 규칙 유지 (최근 개봉작 우선, null 반환)
 *   ② INDIE 상영작 → 같은 인스타 계정의 공지 게시물에서 감독/연도 역참조 (1차 소스)
 *   ③ 없으면 Gemini 텍스트 판정 — 극장 성격 + 같은 극장 라인업 맥락 제공
 *   ④ 확신도 미달 → "skip" (미연결 — 오포스터보다 낫다)
 */

import { db } from "@cinemo/shared";
import { sql } from "drizzle-orm";
import type { KobisMovieListItem } from "../kobis/api";
import { normalizeTitle } from "./movie-match";
import { geminiGenerate } from "../insta/parse";
import { INSTA_ACCOUNTS } from "../insta/accounts";

const JUDGE_CONFIDENCE = 0.7;

interface InstaMovieHint {
  director: string | null;
  year: number | null;
}

/**
 * 인스타 아카이브(raw_posts)에서 이 영화를 다룬 공지의 감독/연도 힌트 수집.
 * 상영 극장의 계정 게시물만 보고, 최근 게시물부터 우선한다.
 */
async function findInstaHints(title: string, handles: Set<string>): Promise<InstaMovieHint[]> {
  const key = normalizeTitle(title);
  if (!key) return [];
  const rows = (await db.all(
    sql`SELECT raw_json FROM raw_posts WHERE source = 'INSTA'`
  )) as { raw_json: string }[];

  const hits: { ts: string; hint: InstaMovieHint }[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.raw_json) as {
        post?: { ownerUsername?: string; timestamp?: string };
        parsed?: { movieTitle?: string | null; director?: string | null; year?: number | null };
      };
      const owner = (payload.post?.ownerUsername ?? "").toLowerCase();
      if (handles.size && !handles.has(owner)) continue; // 그 극장 계정의 게시물만
      const p = payload.parsed;
      if (!p?.movieTitle || normalizeTitle(p.movieTitle) !== key) continue;
      if (p.director || p.year) {
        hits.push({
          ts: payload.post?.timestamp ?? "",
          hint: { director: p.director ?? null, year: p.year ?? null },
        });
      }
    } catch {
      // 개별 행 파싱 실패는 무시
    }
  }
  hits.sort((a, b) => b.ts.localeCompare(a.ts)); // 최근 게시물 우선
  return hits.map((h) => h.hint);
}

/** 힌트(감독/연도)로 후보를 걸러 유일하게 남으면 확정 */
function pickByHint(matched: KobisMovieListItem[], hint: InstaMovieHint): KobisMovieListItem | null {
  const norm = (s: string) => s.replace(/\s+/g, "");
  const pass = matched.filter((c) => {
    if (hint.director) {
      const d = norm(hint.director);
      if (!c.directors.some((x) => norm(x.peopleNm) === d || norm(x.peopleNm).includes(d) || d.includes(norm(x.peopleNm)))) {
        return false;
      }
    }
    if (hint.year) {
      const prdt = Number(c.prdtYear);
      const open = /^\d{8}$/.test(c.openDt) ? Number(c.openDt.slice(0, 4)) : null;
      if (Math.abs(prdt - hint.year) > 1 && (open === null || Math.abs(open - hint.year) > 1)) {
        return false;
      }
    }
    return true;
  });
  return pass.length === 1 ? pass[0] : null;
}

/** 이 영화가 걸린 INDIE 극장들의 이름 + 같은 극장 상영작 목록 (판정 맥락용) */
async function indieContext(movieId: number): Promise<{ theaters: string[]; lineup: string[] }> {
  const theaters = (await db.all(sql`
    SELECT DISTINCT t.id, t.branch_name FROM screenings s
    JOIN theaters t ON t.id = s.theater_id
    WHERE s.movie_id = ${movieId} AND t.chain = 'INDIE'
  `)) as { id: number; branch_name: string }[];
  if (!theaters.length) return { theaters: [], lineup: [] };

  const ids = theaters.map((t) => t.id);
  const lineup = (await db.all(sql`
    SELECT DISTINCT m.title FROM screenings s
    JOIN movies m ON m.id = s.movie_id
    WHERE s.theater_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      AND s.movie_id != ${movieId}
    LIMIT 20
  `)) as { title: string }[];

  return { theaters: theaters.map((t) => t.branch_name), lineup: lineup.map((l) => l.title) };
}

/** Gemini 텍스트 판정 (이미지 없이) */
async function judgeWithGemini(
  title: string,
  matched: KobisMovieListItem[],
  ctx: { theaters: string[]; lineup: string[] }
): Promise<{ movieCd: string | null; confidence: number }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 환경변수 누락");

  const candidates = matched
    .map(
      (c, i) =>
        `${i + 1}. movieCd=${c.movieCd} | 개봉 ${c.openDt || "미상"} | 제작 ${c.prdtYear} | ${c.repNationNm} | ${c.repGenreNm} | 감독 ${c.directors.map((d) => d.peopleNm).join(", ") || "미상"}`
    )
    .join("\n");

  const prompt = `한국의 독립·예술영화관에서 현재 "${title}"라는 영화를 상영 중입니다.
독립영화관은 고전 재개봉·회고전이 흔하지만 신작 독립영화도 상영합니다.

상영 극장: ${ctx.theaters.join(", ") || "미상"}
같은 극장에서 함께 상영 중인 영화들: ${ctx.lineup.join(", ") || "미상"}

동명의 영화 후보가 여러 개입니다. 함께 상영 중인 라인업의 성격(고전 회고전인지, 신작 중심인지)을
근거로 어느 후보가 실제 상영작인지 판단하세요.

후보:
${candidates}

- movieCd: 가장 유력한 후보의 movieCd
- confidence: 확신도 0~1. 근거가 약하면 낮게.`;

  const out = await geminiGenerate<{ movieCd?: string; confidence?: number }>(
    [{ text: prompt }],
    {
      type: "OBJECT",
      properties: {
        movieCd: { type: "STRING" },
        confidence: { type: "NUMBER" },
      },
      required: ["movieCd", "confidence"],
    }
  );
  return { movieCd: out.movieCd ?? null, confidence: out.confidence ?? 0 };
}

/**
 * 동명 후보 중 하나를 고른다.
 * @returns 후보 | "skip"(보류 — 미연결 유지) | null(기본 규칙 사용: 최근 개봉작)
 */
export async function disambiguateKobis(
  movieId: number,
  title: string,
  matched: KobisMovieListItem[]
): Promise<KobisMovieListItem | "skip" | null> {
  // ① INDIE 상영이 아니면 기본 규칙 (체인 상영작 = 최근 개봉작 prior)
  const ctx = await indieContext(movieId);
  if (!ctx.theaters.length) return null;

  // ② 인스타 공지 역참조 — 그 극장 계정이 직접 쓴 감독/연도 (1차 소스).
  //    최근 게시물부터, 후보가 유일하게 갈릴 때까지 순회 (노이즈 힌트는 건너뜀)
  const handles = new Set(
    INSTA_ACCOUNTS.filter((a) => ctx.theaters.includes(a.theaterName)).map((a) => a.handle.toLowerCase())
  );
  for (const hint of await findInstaHints(title, handles)) {
    const byHint = pickByHint(matched, hint);
    if (byHint) {
      console.log(`    ↳ 인스타 공지 힌트로 확정 (감독=${hint.director ?? "-"}, 연도=${hint.year ?? "-"})`);
      return byHint;
    }
  }

  // ③ Gemini 판정 — 라인업 맥락
  try {
    const judged = await judgeWithGemini(title, matched, ctx);
    if (judged.confidence >= JUDGE_CONFIDENCE) {
      const pick = matched.find((c) => c.movieCd === judged.movieCd);
      if (pick) {
        console.log(`    ↳ Gemini 판정: ${pick.movieCd} (${pick.prdtYear}, ${pick.repNationNm}) conf=${judged.confidence}`);
        return pick;
      }
    }
    console.log(`    ↳ Gemini 저신뢰(${judged.confidence}) — 연결 보류`);
  } catch (err) {
    console.error(`    ↳ Gemini 판정 실패: ${(err as Error).message.slice(0, 100)} — 연결 보류`);
  }
  // ④ 확정 실패 — 오매칭보다 미연결
  return "skip";
}
