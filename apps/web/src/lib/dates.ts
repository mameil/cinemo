export const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

/** 로컬 타임존 기준 YYYY-MM-DD (toISOString은 UTC라 자정 근처에 하루 밀린다) */
export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 날짜별 상영정보 등록 범위 (API coverage.dateCoverage) */
export interface DateCoverage {
  date: string;
  screeningCount: number;
  theaterCount: number;
  indieTheaterCount: number;
}

export interface DateChip {
  date: string;
  day: number;
  label: string;
}

/**
 * 오늘부터 DB 마지막 상영일(maxDate)까지 날짜 칩 목록 — 하드코딩 금지.
 * 폴백 8일(로딩 중·값 없음), 상한 21일(이상값 방어).
 */
export function buildDateChips(maxDate?: string | null): DateChip[] {
  const today = new Date();
  const todayText = localDateString(today);
  let count = 8;
  if (maxDate && /^\d{4}-\d{2}-\d{2}$/.test(maxDate) && maxDate >= todayText) {
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diff = Math.round((new Date(`${maxDate}T00:00:00`).getTime() - todayMidnight.getTime()) / 86_400_000) + 1;
    count = Math.min(Math.max(diff, 1), 21);
  }
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    return {
      date: localDateString(date),
      day: date.getDate(),
      label: index === 0 ? "오늘" : index === 1 ? "내일" : DAY_NAMES[date.getDay()],
    };
  });
}
