import { db, movies } from "@cinemo/shared";
import { eq, isNull } from "drizzle-orm";
import {
  fetchMovieList,
  formatOpenDt,
  type KobisMovieListItem,
} from "./kobis/api";
import { normalizeTitle } from "./db/movie-match";
import { disambiguateKobis } from "./db/movie-disambiguate";

// 지정한 시간(ms)만큼 대기 (KOBIS rate limit 여유용)
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * KOBIS 후보 목록에서 제목이 정규화 기준으로 일치하는 항목들을 정렬해 반환.
 * - 제목 정규화가 일치하는 것만
 * - openDt(개봉일)가 있는 것 우선, 그중 가장 최근 것 앞으로
 */
function pickMatches(
  title: string,
  candidates: KobisMovieListItem[]
): KobisMovieListItem[] {
  const key = normalizeTitle(title);
  if (!key) return [];

  const matched = candidates.filter((c) => normalizeTitle(c.movieNm) === key);
  // openDt 있는 것 우선, 그중 최근(문자열 내림차순) 우선
  matched.sort((a, b) => {
    const aHas = /^\d{8}$/.test(a.openDt) ? 1 : 0;
    const bHas = /^\d{8}$/.test(b.openDt) ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return b.openDt.localeCompare(a.openDt);
  });
  return matched;
}

/** 배치 모드: movies 중 kobisCode 가 비어있는 행에 KOBIS 영화코드/개봉일을 채운다. */
export async function backfill(dry: boolean): Promise<void> {
  console.log(
    `=== KOBIS 백필 시작${dry ? " (DRY RUN — DB 미변경)" : ""} ===`
  );
  const pending = await db
    .select()
    .from(movies)
    .where(isNull(movies.kobisCode));

  console.log(`대상 영화 ${pending.length}건\n`);

  let updated = 0;
  let missed = 0;
  for (const movie of pending) {
    // KOBIS 검색은 문장부호에 민감 ("편-화진담"으로 검색하면 "편 : 화진담"이 안 나옴)
    // → 원제 → 특수문자 제거 → 첫 단어 순으로 점진 축약 재검색.
    //   pickBestMatch가 정규화 완전일치만 통과시키므로 넓은 쿼리도 안전하다.
    const queries = [
      movie.title,
      movie.title.replace(/[^0-9a-zA-Z가-힣\s]/g, " ").replace(/\s+/g, " ").trim(),
      movie.title.split(/\s+/)[0],
    ].filter((q, i, arr) => q.length >= 2 && arr.indexOf(q) === i);

    let candidates: KobisMovieListItem[] = [];
    let best: KobisMovieListItem | null = null;
    let searchFailed = false;
    let ambiguousSkip = false;
    for (const q of queries) {
      try {
        const res = await fetchMovieList({ movieNm: q, itemPerPage: 100 });
        candidates = res.list;
      } catch (err) {
        console.log(
          `  ! [${movie.id}] "${movie.title}" — KOBIS 검색 실패(q="${q}"): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        searchFailed = true;
        break;
      }
      const matched = pickMatches(movie.title, candidates);
      if (matched.length === 1) {
        best = matched[0];
      } else if (matched.length > 1) {
        // 동명 영화 — INDIE 상영작은 공지 역참조/Gemini 판정, 체인 상영작은 최근 개봉작
        console.log(`  ? [${movie.id}] "${movie.title}" — 동명 후보 ${matched.length}건, 판별 시도`);
        const picked = await disambiguateKobis(movie.id, movie.title, matched);
        if (picked === "skip") {
          ambiguousSkip = true;
        } else {
          best = picked ?? matched[0];
        }
      }
      if (best || ambiguousSkip) break;
      await sleep(250);
    }
    if (searchFailed) {
      missed++;
      await sleep(250);
      continue;
    }
    if (ambiguousSkip) {
      console.log(`  ⏸ [${movie.id}] "${movie.title}" — 동명 후보 판별 실패, 연결 보류`);
      missed++;
      await sleep(250);
      continue;
    }
    if (!best) {
      console.log(
        `  ✗ [${movie.id}] "${movie.title}" — 매칭 없음 (후보 ${candidates.length}건)`
      );
      missed++;
      await sleep(250);
      continue;
    }

    const kobisCode = best.movieCd;
    const releaseDate = best.openDt ? formatOpenDt(best.openDt) : null;
    // 영문 제목도 저장 — TMDB 한글 미등재 시 재검색용 (tmdb-sync 폴백)
    const titleEn = best.movieNmEn?.trim() || null;

    if (!dry) {
      await db
        .update(movies)
        .set({ kobisCode, releaseDate, titleEn })
        .where(eq(movies.id, movie.id));
    }

    console.log(
      `  ✓ [${movie.id}] "${movie.title}" → "${best.movieNm}" kobisCode=${kobisCode}, release=${releaseDate ?? "-"}${titleEn ? `, en="${titleEn}"` : ""}`
    );
    updated++;
    await sleep(250);
  }

  console.log(
    `\n=== 완료${dry ? " (DRY RUN)" : ""}: ${updated}건 ${
      dry ? "매칭" : "업데이트"
    }, ${missed}건 미매칭 ===`
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const dry = args.includes("--dry");
  await backfill(dry);
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
