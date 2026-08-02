// ── TMDB 클라이언트 ────────────────────────────────
// 영화명 → TMDB 검색 → 한국어 포스터 중 평점 1위 자동 선택.
// 인증: TMDB_ACCESS_TOKEN(Bearer) 우선, 없으면 TMDB_API_KEY(query) 폴백.

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p";
const DEFAULT_POSTER_SIZE = "w500";

export interface TmdbMovie {
  tmdbId: number;
  title: string;
  originalTitle: string;
  releaseDate: string | null;
}

export interface ResolvedPoster {
  tmdbId: number;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
}

interface TmdbSearchResult {
  id: number;
  title: string;
  original_title: string;
  release_date: string;
  poster_path: string | null;
}

interface TmdbPoster {
  file_path: string;
  iso_639_1: string | null;
  vote_average: number;
  vote_count: number;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  const token = process.env.TMDB_ACCESS_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function tmdbFetch<T>(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const token = process.env.TMDB_ACCESS_TOKEN;
  const apiKey = process.env.TMDB_API_KEY;
  if (!token && !apiKey) {
    throw new Error(
      "TMDB 인증 정보 없음: TMDB_ACCESS_TOKEN 또는 TMDB_API_KEY 환경변수를 설정하세요."
    );
  }

  const url = new URL(`${TMDB_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  // Bearer 토큰이 없을 때만 api_key 쿼리 사용
  if (!token && apiKey) url.searchParams.set("api_key", apiKey);

  const res = await fetch(url, { headers: buildHeaders() });
  if (!res.ok) {
    throw new Error(`TMDB 요청 실패 ${res.status} ${res.statusText}: ${path}`);
  }
  return res.json() as Promise<T>;
}

/** 완전한 포스터 URL 조립. path 는 TMDB file_path("/xxxx.jpg"). */
export function buildPosterUrl(
  filePath: string,
  size: string = DEFAULT_POSTER_SIZE
): string {
  return `${IMAGE_BASE}/${size}${filePath}`;
}

/** 영화명(+선택 연도)으로 TMDB 검색. 가장 관련도 높은 1건 반환, 없으면 null. */
export async function searchMovie(
  title: string,
  year?: number
): Promise<TmdbMovie | null> {
  const data = await tmdbFetch<{ results: TmdbSearchResult[] }>(
    "/search/movie",
    {
      query: title,
      language: "ko-KR",
      include_adult: "false",
      primary_release_year: year,
    }
  );

  const best = data.results?.[0];
  if (!best) return null;

  return {
    tmdbId: best.id,
    title: best.title,
    originalTitle: best.original_title,
    releaseDate: best.release_date || null,
  };
}

/**
 * TMDB 크레딧에서 감독 이름 목록 조회 — 동명·동년 작품 판별용 (KOBIS 감독과 대조).
 * 크레딧이 없으면 빈 배열 (검증 불가 → 호출측에서 통과 처리).
 */
export async function fetchTmdbDirectors(tmdbId: number): Promise<string[]> {
  const data = await tmdbFetch<{ crew?: { job: string; name: string }[] }>(
    `/movie/${tmdbId}/credits`,
    {}
  );
  return (data.crew ?? []).filter((c) => c.job === "Director").map((c) => c.name);
}

/**
 * 해당 영화의 포스터 후보 중 대표 1장 선택.
 * 우선순위: 한국어(ko) → 영어(en) → 언어중립(null) → 나머지.
 * 같은 그룹 내에서는 vote_average → vote_count 순으로 최고 선택.
 * 포스터가 없으면 null.
 */
export async function pickBestPosterUrl(
  tmdbId: number,
  size: string = DEFAULT_POSTER_SIZE
): Promise<string | null> {
  const data = await tmdbFetch<{ posters: TmdbPoster[] }>(
    `/movie/${tmdbId}/images`,
    { include_image_language: "ko,en,null" }
  );

  const posters = data.posters ?? [];
  if (posters.length === 0) return null;

  const rank = (iso: string | null): number => {
    if (iso === "ko") return 0;
    if (iso === "en") return 1;
    if (iso === null) return 2;
    return 3;
  };

  const best = [...posters].sort((a, b) => {
    const langDiff = rank(a.iso_639_1) - rank(b.iso_639_1);
    if (langDiff !== 0) return langDiff;
    if (b.vote_average !== a.vote_average) return b.vote_average - a.vote_average;
    return b.vote_count - a.vote_count;
  })[0];

  return buildPosterUrl(best.file_path, size);
}

/**
 * 영화명 → { tmdbId, title, releaseDate, posterUrl } 한 번에 해결.
 * 검색 결과가 없으면 null. 포스터 이미지 목록이 비면 검색결과 poster_path 로 폴백.
 */
export async function resolveMoviePoster(
  title: string,
  year?: number,
  size: string = DEFAULT_POSTER_SIZE
): Promise<ResolvedPoster | null> {
  const data = await tmdbFetch<{ results: TmdbSearchResult[] }>(
    "/search/movie",
    {
      query: title,
      language: "ko-KR",
      include_adult: "false",
      primary_release_year: year,
    }
  );

  const best = data.results?.[0];
  if (!best) return null;

  let posterUrl = await pickBestPosterUrl(best.id, size);
  if (!posterUrl && best.poster_path) {
    posterUrl = buildPosterUrl(best.poster_path, size);
  }

  return {
    tmdbId: best.id,
    title: best.title,
    releaseDate: best.release_date || null,
    posterUrl,
  };
}
