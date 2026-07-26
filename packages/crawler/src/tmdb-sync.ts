import { db, movies, resolveMoviePoster } from "@cinemo/shared";
import { eq, isNull, or } from "drizzle-orm";
import { fetchMovieInfo } from "./kobis/api";

// 지정한 시간(ms)만큼 대기 (TMDB rate limit 여유용)
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** CLI 단일 조회 모드: 영화명으로 TMDB를 조회해 결과만 출력 (DB 미변경). */
async function lookupOnly(title: string, year?: number): Promise<void> {
  console.log(`=== TMDB 조회: "${title}"${year ? ` (${year})` : ""} ===`);
  const result = await resolveMoviePoster(title, year);
  if (!result) {
    console.log("검색 결과 없음");
    return;
  }
  console.log(`  tmdbId    : ${result.tmdbId}`);
  console.log(`  title     : ${result.title}`);
  console.log(`  release   : ${result.releaseDate ?? "-"}`);
  console.log(`  posterUrl : ${result.posterUrl ?? "(포스터 없음)"}`);
}

/** 배치 모드: movies 중 tmdbId 또는 posterUrl 이 비어있는 행을 채운다. */
export async function syncMovies(): Promise<void> {
  console.log("=== TMDB 포스터 동기화 시작 ===");
  const pending = await db
    .select()
    .from(movies)
    .where(or(isNull(movies.tmdbId), isNull(movies.posterUrl)));

  console.log(`대상 영화 ${pending.length}건\n`);

  let updated = 0;
  let missed = 0;
  for (const movie of pending) {
    // 검증: TMDB 원 개봉이 KOBIS 한국 개봉보다 뒤일 수는 없다 (+1년 유예).
    // 동명 영화 오매칭 방지 — 예: 라이카 상영 "부기나이트"(KOBIS 개봉 1999)가
    // 2022년 한국 동명 영화(TMDB)로 붙는 케이스. 고전 재개봉(키키: TMDB 1989 ≤ KOBIS 2007)은 통과.
    const openYear = movie.releaseDate ? Number(movie.releaseDate.slice(0, 4)) : null;
    const plausible = (r: { releaseDate: string | null }) =>
      !openYear || !r.releaseDate || Number(r.releaseDate.slice(0, 4)) <= openYear + 1;

    let result = await resolveMoviePoster(movie.title);
    if (result && !plausible(result)) {
      console.log(
        `  ⚠ [${movie.id}] "${movie.title}" — TMDB 후보(${result.releaseDate})가 한국 개봉(${movie.releaseDate})보다 늦음, 기각 → 영문명 재시도`
      );
      result = null;
    }

    // 폴백: 한글 검색 실패 → 영문 제목으로 재검색.
    // 일본 애니 총집편 등은 TMDB에 한글 제목이 미등재인 경우가 있다
    // (예: "블리치 천년혈전 편-화진담" → "Bleach: Thousand-Year Blood War - The Calamity")
    if (!result) {
      // 1) 저장된 영문명 (kobis-backfill이 채움) — KOBIS 재호출 없이 바로
      let en = movie.titleEn?.trim() || null;
      // 2) 없으면 KOBIS 상세에서 실시간 조회 후 저장 (자가 치유)
      if (!en && movie.kobisCode) {
        try {
          const info = await fetchMovieInfo(movie.kobisCode);
          en = info.movieNmEn?.trim() || null;
          if (en) {
            await db.update(movies).set({ titleEn: en }).where(eq(movies.id, movie.id));
          }
        } catch {
          // KOBIS 상세 실패는 폴백만 포기
        }
      }
      if (en && en.length >= 2) {
        result = await resolveMoviePoster(en);
        if (result && !plausible(result)) {
          console.log(`  ⚠ [${movie.id}] 영문명 후보(${result.releaseDate})도 개봉연도 불일치, 기각`);
          result = null;
        }
        if (result) {
          console.log(`  ↻ [${movie.id}] 한글 미등재/기각 → 영문명 "${en}"으로 매칭`);
        }
      }
    }

    if (!result) {
      console.log(`  ✗ [${movie.id}] "${movie.title}" — TMDB 검색 결과 없음`);
      missed++;
      await sleep(250);
      continue;
    }

    await db
      .update(movies)
      .set({ tmdbId: result.tmdbId, posterUrl: result.posterUrl })
      .where(eq(movies.id, movie.id));

    console.log(
      `  ✓ [${movie.id}] "${movie.title}" → tmdbId=${result.tmdbId}, poster=${
        result.posterUrl ? "O" : "X"
      }`
    );
    updated++;
    await sleep(250);
  }

  console.log(`\n=== 완료: ${updated}건 업데이트, ${missed}건 미매칭 ===`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const title = args[0];
  const year = args[1] && /^\d{4}$/.test(args[1]) ? Number(args[1]) : undefined;

  if (title) {
    await lookupOnly(title, year);
  } else {
    await syncMovies();
  }
}

// 엔트리로 직접 실행될 때만 main 실행 (오케스트레이터에서 import 시 자동 실행 방지)
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
