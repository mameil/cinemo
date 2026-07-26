/**
 * 영화 매칭 + 굿즈 분류 헬퍼
 *
 * 이벤트/굿즈는 영화를 "이름"으로만 참조하므로, 제목을 정규화해 movies 테이블과 매칭한다.
 * 매칭되는 행이 없으면 제목만으로 즉석 생성(upsert)하고, KOBIS 코드/TMDB 포스터는
 * 이후 백필 단계에서 채운다.
 */

import { db, movies } from "@cinemo/shared";
import type { GoodieType } from "../domain";

/**
 * 제목 정규화 — 매칭 키 생성용.
 * 대괄호 태그([CGV], [단독] 등), 괄호 부가정보, 공백/특수문자를 제거해
 * 표기 차이를 흡수한다. 예: "[단독] 하얼빈 (2026)" → "하얼빈"
 */
export function normalizeTitle(title: string): string {
  return title
    .replace(/\[[^\]]*\]/g, "") // [브랜드] 태그 제거
    .replace(/\([^)]*\)/g, "") // (부가정보) 제거
    .replace(/[^0-9a-z가-힣]/gi, "") // 공백·특수문자 제거
    .toLowerCase();
}

// 제목(정규화) → movieId 캐시. 프로세스 1회 실행 동안만 유효.
let cache: Map<string, number> | null = null;

async function loadCache(): Promise<Map<string, number>> {
  if (cache) return cache;
  cache = new Map();
  const rows = await db
    .select({ id: movies.id, title: movies.title })
    .from(movies);
  for (const row of rows) {
    const key = normalizeTitle(row.title);
    if (key && !cache.has(key)) cache.set(key, row.id);
  }
  return cache;
}

/**
 * 제목으로 영화를 찾거나 없으면 생성한다.
 * @returns movieId, 정규화 결과가 비면(제목 추출 실패) null
 */
export async function findOrCreateMovie(
  rawTitle: string
): Promise<number | null> {
  const key = normalizeTitle(rawTitle);
  if (!key) return null;

  const c = await loadCache();
  const hit = c.get(key);
  if (hit !== undefined) return hit;

  const [row] = await db
    .insert(movies)
    .values({ title: rawTitle.trim() })
    .returning({ id: movies.id });
  c.set(key, row.id);
  return row.id;
}

/**
 * 제목으로 "기존" 영화만 찾는다 — 없으면 null (생성하지 않음).
 * 일반 이벤트(무대인사·제휴 등) 연결용: 콘서트·스포츠 중계 같은 비영화 제목이
 * movies에 쌓여 KOBIS/TMDB 백필 대상을 오염시키는 것을 막는다. (2026-07-19 크론 타임아웃 원인 중 하나)
 */
export async function findMovieOnly(rawTitle: string): Promise<number | null> {
  const key = normalizeTitle(rawTitle);
  if (!key) return null;
  const c = await loadCache();
  return c.get(key) ?? null;
}

/** 테스트/재실행 편의를 위한 캐시 초기화 */
export function resetMovieCache(): void {
  cache = null;
}

/** 굿즈 이름으로 종류를 추정한다. */
export function classifyGoodieType(name: string): GoodieType {
  if (/포스터|poster/i.test(name)) return "포스터";
  if (/오리지널\s*티켓|original\s*ticket|\bot\b/i.test(name)) return "OT";
  if (/\bttt\b|투명\s*티켓/i.test(name)) return "TTT";
  return "기타";
}
