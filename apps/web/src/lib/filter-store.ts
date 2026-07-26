import type { Chain } from "@mock/types";

const KEY = "cinemo-filters";

interface FilterState {
  excludedTheaters: number[];
  excludedChains: Chain[];
  excludedMovies: number[];
  afterNow: boolean;
  /** 특전 받는 상영만 보기 (예전 저장분엔 없을 수 있음) */
  goodieOnly?: boolean;
  view: "movie" | "time";
  selectedDate: string;
}

export function saveFilters(state: FilterState) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

export function loadFilters(): FilterState | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FilterState;
  } catch {
    return null;
  }
}
