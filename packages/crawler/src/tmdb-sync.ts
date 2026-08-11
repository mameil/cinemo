import { db, movies, resolveMoviePoster, fetchTmdbDirectors } from "@cinemo/shared";
import { eq, isNull, or, sql } from "drizzle-orm";
import { fetchMovieInfo } from "./kobis/api";
import { isNonFilm, shouldAttemptMatch, RECHECK_DAYS } from "./db/backfill-policy";

// 지정한 시간(ms)만큼 대기 (TMDB rate limit 여유용)
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 극장이 본편 제목에 기획전명·토크 정보를 붙인 편성명에서 안전한 검색 별칭을 만든다.
 * 임의의 콜론/대괄호를 전부 지우지 않는다. 실제 수집된 기획전 표기만 허용해
 * 원래 제목의 일부를 잘라 엉뚱한 동명작 포스터가 붙는 것을 막는다.
 */
export function posterSearchAliases(title: string): string[] {
  if (/^\d+강\.|\+\s*강의\b/u.test(title)) return [];

  const aliases = new Set<string>();
  const add = (value: string) => {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length >= 2 && normalized !== title) aliases.add(normalized);
  };

  add(title.replace(/^\[(?:시네마투어|정시상영단)\]\s*/u, ""));
  add(title.replace(/^보여줘,\s*시네클럽!\s*/u, ""));
  add(title.replace(/^애니살롱전\s*\d+월\s*:\s*/u, ""));
  add(title.replace(/^금요일밤의\s*동시상영\s*:\s*/u, ""));
  add(title.replace(/\s*\+\s*(?:시네토크|GV|관객과의\s*대화)\b.*$/iu, ""));

  // 합본은 편성 전체가 단일 작품이 아니므로 첫 본편 포스터만 대표 이미지로 사용한다.
  for (const alias of [title, ...aliases]) {
    if (!alias.includes("+")) continue;
    add(alias.split("+")[0]);
  }

  return [...aliases];
}

/**
 * KOBIS 감독 ↔ TMDB 감독 대조 — 연도까지 같은 동명작 구분의 최종 관문.
 * (2026-08-02 지난 여름 사건: 최승우 2023작이 같은 제목·같은 해 프랑스 단편에 붙음 — 연도 필터 무력)
 * 이름 토큰 교집합 판정: 4자 이상 토큰 1개 또는 토큰 2개 이상 일치 → 동일 인물
 * (kim/lee 같은 짧은 성 하나만 겹치는 우연 일치 방지).
 * 문자 체계가 달라 비교 자체가 불가능하면(한글만 ↔ 로마자만) 통과 — 오기각 방지.
 */
function directorsMatch(kobisNames: string[], tmdbNames: string[]): boolean {
  const tokens = (n: string) =>
    n.toLowerCase().normalize("NFKD").replace(/[^a-z가-힣 ]/g, " ").split(/\s+/).filter((t) => t.length >= 2);
  const hasLatin = (arr: string[]) => arr.some((n) => /[a-z]/i.test(n));
  const hasHangul = (arr: string[]) => arr.some((n) => /[가-힣]/.test(n));
  const comparable =
    (hasLatin(kobisNames) && hasLatin(tmdbNames)) || (hasHangul(kobisNames) && hasHangul(tmdbNames));
  if (!comparable) return true;

  const tmdbTokens = tmdbNames.flatMap(tokens);
  for (const name of kobisNames) {
    const common = tokens(name).filter((k) => tmdbTokens.includes(k));
    if (common.some((c) => c.length >= 4) || common.length >= 2) return true;
  }
  return false;
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
  const all = await db
    .select()
    .from(movies)
    .where(or(isNull(movies.tmdbId), isNull(movies.posterUrl)));

  // 재시도 정책 — kobis-backfill과 동일 (같은 실행의 마커는 통과, 주기 재시도)
  const skipped = all.filter((m) => isNonFilm(m.title) || !shouldAttemptMatch(m.matchCheckedAt));
  const pending = all.filter((m) => !isNonFilm(m.title) && shouldAttemptMatch(m.matchCheckedAt));

  console.log(
    `대상 영화 ${pending.length}건 (전체 ${all.length} — 비영화·재시도 대기 ${skipped.length} 제외, 주기 ${RECHECK_DAYS}일)\n`
  );

  let updated = 0;
  let missed = 0;
  for (const movie of pending) {
    // 시도 마커 — 미매칭이어도 다음 주기까지 재검색하지 않도록 선기록
    await db
      .update(movies)
      .set({ matchCheckedAt: new Date().toISOString() })
      .where(eq(movies.id, movie.id));
    // 문맥 확보: KOBIS 상세의 제작연도(prdtYear)·영문명 — 동명 영화 오매칭 방지.
    // 한글 제목만으로는 TMDB 검색 1위가 엉뚱한 동명작일 수 있다
    // (2026-08-02 피아니스트 사건: 하네케 2001 상영작에 폴란스키 2002 포스터).
    let prodYear: number | null = null;
    let titleEn = movie.titleEn?.trim() || null;
    let kobisDirectors: string[] = [];
    if (movie.kobisCode) {
      try {
        const info = await fetchMovieInfo(movie.kobisCode);
        if (/^\d{4}$/.test(info.prdtYear ?? "")) prodYear = Number(info.prdtYear);
        kobisDirectors = (info.directors ?? [])
          .flatMap((d) => [d.peopleNm, d.peopleNmEn])
          .filter((n): n is string => !!n?.trim());
        if (!titleEn) {
          titleEn = info.movieNmEn?.trim() || null;
          if (titleEn) {
            await db.update(movies).set({ titleEn }).where(eq(movies.id, movie.id));
          }
        }
      } catch {
        // KOBIS 상세 실패 시 문맥 없이 진행 (기존 동작)
      }
    }

    // 검증: ① TMDB 원 개봉이 KOBIS 한국 개봉보다 뒤일 수는 없다 (+1년 유예).
    //   예: 라이카 상영 "부기나이트"(KOBIS 개봉 1999)가 2022년 한국 동명 영화(TMDB)로
    //   붙는 케이스 방지. 고전 재개봉(키키: TMDB 1989 ≤ KOBIS 2007)은 통과.
    // ② 제작연도를 알면 TMDB 개봉연도와 ±1년 이내여야 한다 (동명작 구분의 결정 조건).
    const openYear = movie.releaseDate ? Number(movie.releaseDate.slice(0, 4)) : null;
    const plausible = (r: { releaseDate: string | null }) => {
      if (!r.releaseDate) return true;
      const y = Number(r.releaseDate.slice(0, 4));
      if (openYear && y > openYear + 1) return false;
      if (prodYear && Math.abs(y - prodYear) > 1) return false;
      return true;
    };

    // 제작연도를 알면 연도 필터로 정확 검색 → 없거나 실패 시 연도 없이 검색(불변식으로 검증)
    let result = prodYear ? await resolveMoviePoster(movie.title, prodYear) : null;
    if (!result) result = await resolveMoviePoster(movie.title);
    // 기획전 편성명에는 본편 앞뒤로 프로그램명·토크 정보가 붙는다.
    // 실제 수집 형식만 보수적으로 정리한 별칭으로 다시 찾는다.
    if (!result) {
      const numberedTitle = movie.title
        .replace(/\s+\d+\s*[~～-]\s*\d+\s*부(?:\s*\+.*)?$/u, "")
        .replace(/\s+\d+\s*부(?:\s*\+.*)?$/u, "")
        .trim();
      const aliases = new Set([
        ...(numberedTitle !== movie.title ? [numberedTitle] : []),
        ...posterSearchAliases(movie.title),
      ]);
      for (const alias of aliases) {
        result = await resolveMoviePoster(alias);
        if (result) {
          console.log(`  ↻ [${movie.id}] 편성명 → 원 제목 "${alias}"로 매칭`);
          break;
        }
      }
    }
    if (result && !plausible(result)) {
      console.log(
        `  ⚠ [${movie.id}] "${movie.title}" — TMDB 후보(${result.releaseDate}) 연도 불일치(한국개봉 ${movie.releaseDate ?? "-"} / 제작 ${prodYear ?? "-"}), 기각 → 영문명 재시도`
      );
      result = null;
    }

    // 폴백: 한글 검색 실패/기각 → 영문 제목으로 재검색 (KOBIS 영문명은 위에서 확보됨).
    // 일본 애니 총집편 등은 TMDB에 한글 제목이 미등재인 경우가 있다
    // (예: "블리치 천년혈전 편-화진담" → "Bleach: Thousand-Year Blood War - The Calamity")
    if (!result && titleEn && titleEn.length >= 2) {
      result = prodYear ? await resolveMoviePoster(titleEn, prodYear) : null;
      if (!result) result = await resolveMoviePoster(titleEn);
      if (result && !plausible(result)) {
        console.log(`  ⚠ [${movie.id}] 영문명 후보(${result.releaseDate})도 연도 불일치, 기각`);
        result = null;
      }
      if (result) {
        console.log(`  ↻ [${movie.id}] 한글 미등재/기각 → 영문명 "${titleEn}"으로 매칭`);
      }
    }

    // 최종 관문: 감독 대조 (연도가 같은 동명작은 여기서만 걸러진다)
    if (result && kobisDirectors.length) {
      try {
        const tmdbDirectors = await fetchTmdbDirectors(result.tmdbId);
        if (tmdbDirectors.length && !directorsMatch(kobisDirectors, tmdbDirectors)) {
          console.log(
            `  ⚠ [${movie.id}] "${movie.title}" — 감독 불일치 (KOBIS ${kobisDirectors.join("/")} ↔ TMDB ${tmdbDirectors.join("/")}), 기각`
          );
          result = null;
        }
      } catch {
        // 크레딧 조회 실패는 검증 생략 (기존 동작 유지)
      }
    }

    if (!result) {
      console.log(`  ✗ [${movie.id}] "${movie.title}" — TMDB 검색 결과 없음/기각`);
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
  await backfillPosterFallback();
}

/**
 * 포스터 폴백: TMDB에 없는 영화는 빈칸 대신 **극장이 올린 공지 이미지**를 노출한다
 * (2026-08-02 사용자 결정 — 첫 케이스: 최승우 〈지난 여름〉, TMDB 미등재 국내 독립영화).
 * 우선순위: 영화(개봉 공지 — 대부분 포스터 원본) > 특전 > 상영회 > 기타.
 * tmdbId가 비어 있는 행은 주기 재시도가 계속되므로, 진짜 포스터가 매칭되면 자동 교체된다.
 */
async function backfillPosterFallback(): Promise<void> {
  const rows = (await db.all(sql`
    SELECT m.id AS id,
      (SELECT e.image_url FROM events e
        WHERE e.movie_id = m.id AND e.image_url IS NOT NULL
        ORDER BY CASE e.category WHEN '영화' THEN 0 WHEN '특전' THEN 1 WHEN '상영회' THEN 2 ELSE 3 END,
                 e.id DESC
        LIMIT 1) AS img
    FROM movies m
    WHERE m.poster_url IS NULL
  `)) as { id: number; img: string | null }[];

  const targets = rows.filter((r) => r.img);
  for (const r of targets) {
    await db.run(sql`UPDATE movies SET poster_url = ${r.img} WHERE id = ${r.id} AND poster_url IS NULL`);
  }
  console.log(`=== 포스터 폴백(극장 공지 이미지): ${targets.length}건 적용 (대상 ${rows.length}건) ===`);

  // 3차 폴백: 본편을 식별할 수 있는 특별 편성은 원 작품의 포스터만 빌려온다.
  // tmdbId는 기록하지 않는다 — 기획전·합본 편성 자체는 단일 TMDB 작품이 아니다.
  const specialPrograms = (await db.all(sql`
    SELECT id, title FROM movies WHERE poster_url IS NULL
  `)) as { id: number; title: string }[];
  let specialFilled = 0;
  let specialTargets = 0;
  for (const program of specialPrograms) {
    const aliases = posterSearchAliases(program.title);
    if (aliases.length === 0) continue;
    specialTargets++;
    for (const alias of aliases) {
      try {
        const result = await resolveMoviePoster(alias);
        if (result?.posterUrl) {
          await db.run(sql`UPDATE movies SET poster_url = ${result.posterUrl} WHERE id = ${program.id} AND poster_url IS NULL`);
          console.log(`  ↻ 특별 편성 "${program.title}" → 본편 "${alias}" 포스터 차용`);
          specialFilled++;
          break;
        }
      } catch {
        // 조회 실패는 다음 실행에서 재시도
      }
      await sleep(250);
    }
  }
  if (specialTargets) {
    console.log(`=== 특별 편성 포스터 차용: ${specialFilled}/${specialTargets}건 ===`);
  }
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
