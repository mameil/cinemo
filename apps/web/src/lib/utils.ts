import type { Chain } from "@mock/types";

export const CHAIN_COLOR: Record<Chain, string> = {
  CGV: "var(--color-cgv)",
  LOTTE: "var(--color-lotte)",
  MEGA: "var(--color-mega)",
  INDIE: "var(--color-indie)",
};

export const CHAIN_LABEL: Record<Chain, string> = {
  CGV: "CGV",
  LOTTE: "롯데",
  MEGA: "메가",
  INDIE: "독립",
};

export function seatStatus(remaining: number | null, total: number | null) {
  if (remaining === null || total === null) return "unknown" as const;
  if (remaining === 0) return "soldout" as const;
  if (remaining / total <= 0.1) return "low" as const;
  return "ok" as const;
}

export function formatLabel(format: string | null): {
  label: string;
  variant: "default" | "premium" | "imax";
} {
  if (!format) return { label: "2D", variant: "default" };
  const upper = format.toUpperCase();
  if (upper.includes("IMAX")) return { label: "IMAX", variant: "imax" };
  if (upper.includes("MX") || upper.includes("SUPER") || upper.includes("4DX") || upper.includes("SCREEN"))
    return { label: format.replace(/\s*2D$/i, ""), variant: "premium" };
  return { label: format, variant: "default" };
}

/** 특전 종류 배지 — 체인 필터 칩과 같은 스타일 (청록 테두리 + 연민트 배경) */
export const GOODIE_BADGE_CLASS =
  "text-goodie border-goodie bg-goodie-tint hover:bg-goodie-line/40";

/** 특전 받는 상영 칩 틴트 */
export const GOODIE_CHIP_CLASS = "border-goodie-line bg-goodie-tint/60";

/**
 * 굿즈 실명 정리 — "[키퍼] 리즈 포스터 2종" → "리즈 포스터 2종".
 * 영화 태그([..]/<..>)와 HTML 엔티티를 정리해 "뭘 받는지"만 남긴다.
 */
export function cleanGoodieName(name: string): string {
  return name
    .replace(/&lt;[^&]*&gt;|&lt;|&gt;/g, " ") // 인코딩된 <영화명>
    .replace(/\[[^\]]*\]|<[^>]*>/g, " ") // [영화명]·[굿즈증정] 등 태그
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 상영관 이름 축약 — 칩에 들어갈 짧은 형태.
 * "컴포트 104호 [Laser]" → "컴포트 104호", "2관 (Laser)" → "2관"
 */
export function shortScreenName(name: string | null): string | null {
  if (!name) return null;
  const s = name
    .replace(/\s*[\[(][^\])]*[\])]\s*/g, " ") // [Laser] (자막) 등 괄호 제거
    .replace(/\s+/g, " ")
    .trim();
  return s || null;
}

export function timeSlot(time: string): string {
  const hour = parseInt(time.split(":")[0], 10);
  if (hour < 12) return "오전";
  if (hour < 17) return "오후";
  return "저녁";
}
