"use client";

import { buildDateChips, type DateCoverage } from "@/lib/dates";

interface Props {
  selectedDate: string;
  onChange: (date: string) => void;
  maxDate?: string | null;
  dateCoverage?: DateCoverage[];
  /** 데이터 도착 전에는 "일정 없음" 대신 중립 플레이스홀더를 보여준다 (로딩 중 오정보 방지) */
  loading?: boolean;
}

/** 홈·영화/시간·극장 화면 공용 날짜 칩 스트립 — 등록 극장 수 표시 포함 */
export default function DateStrip({ selectedDate, onChange, maxDate, dateCoverage, loading = false }: Props) {
  const dates = buildDateChips(maxDate);
  const coverageByDate = new Map((dateCoverage ?? []).map((item) => [item.date, item]));

  return (
    <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
      {dates.map((item) => {
        const active = item.date === selectedDate;
        const status = coverageByDate.get(item.date);
        return (
          <button
            key={item.date}
            onClick={() => onChange(item.date)}
            aria-current={active ? "date" : undefined}
            className={`flex-none rounded-xl border px-2.5 py-1.5 text-center ${active ? "border-ink bg-ink text-ground" : "border-line bg-panel text-ink"}`}
          >
            <small className={`block text-[10px] ${active ? "text-ground/70" : "text-ink-3"}`}>{item.label}</small>
            <b className="block text-[15px] leading-tight">{active && <span className="mr-0.5" aria-hidden="true">✓</span>}{item.day}</b>
            <span className={`mt-0.5 block text-[10px] tabular-nums ${active ? "text-ground/75" : "text-ink-3"}`}>
              {loading ? "· · ·" : status ? `${status.theaterCount}개 극장` : "일정 없음"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
