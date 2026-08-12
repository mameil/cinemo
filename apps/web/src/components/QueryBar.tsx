"use client";

import { useState } from "react";
import { SearchIcon, XIcon, FilmIcon, ClockIcon, CalendarIcon, MapPinIcon } from "@/components/icons";

export interface QueryChip {
  key: "movie" | "location" | "time" | "date";
  label: string;
}

const CHIP_ICON = {
  movie: FilmIcon,
  location: MapPinIcon,
  time: ClockIcon,
  date: CalendarIcon,
} as const;

interface Props {
  chips: QueryChip[];
  hint: string | null;
  onSubmit: (raw: string) => void;
  onRemoveChip: (key: string) => void;
  onClearAll: () => void;
}

/**
 * 쿼리 한 줄 입력 — 시간/장소/영화를 파싱해 시간표 필터로 반영.
 * 대화형이 아니라 검색 쿼리: 결과는 아래 시간표가 그대로 보여준다.
 */
export default function QueryBar({ chips, hint, onSubmit, onRemoveChip, onClearAll }: Props) {
  const [value, setValue] = useState("");

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = value.trim();
          if (v) {
            onSubmit(v);
            setValue("");
          }
        }}
        className="flex items-center gap-2 rounded-xl border border-line bg-ground px-3 py-2 focus-within:border-app transition-colors"
      >
        <SearchIcon size={15} className="text-ink-3" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="영화 · 장소 · 시간으로 찾기  (예: 주토피아 일산 저녁)"
          className="flex-1 min-w-0 bg-transparent text-[14px] outline-none placeholder:text-ink-3"
        />
        {value.trim() && (
          <button type="submit" className="flex-none text-[12px] font-bold text-app">
            찾기
          </button>
        )}
      </form>

      {(chips.length > 0 || hint) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => {
            const ChipIcon = CHIP_ICON[c.key];
            return (
              <button
                key={c.key}
                onClick={() => onRemoveChip(c.key)}
                className="inline-flex items-center gap-1 rounded-full border border-app bg-app-tint px-2 py-0.5 text-[12px] font-semibold text-app hover:opacity-70 transition-opacity"
              >
                <ChipIcon size={11} /> {c.label} <XIcon size={10} />
              </button>
            );
          })}
          {chips.length > 1 && (
            <button
              onClick={onClearAll}
              className="text-[11px] text-ink-3 hover:text-soldout transition-colors"
            >
              모두 지우기
            </button>
          )}
          {hint && <span className="text-[11px] text-soldout">{hint}</span>}
        </div>
      )}
    </div>
  );
}
