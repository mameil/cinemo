"use client";

import { useEffect } from "react";
import type { EventPreview } from "@mock/types";
import { GOODIE_BADGE_CLASS } from "@/lib/utils";

const CHAIN_LABEL: Record<string, string> = { CGV: "CGV", LOTTE: "롯데", MEGA: "메가", INDIE: "독립" };
const CHAIN_CLASS: Record<string, string> = { CGV: "bg-cgv", LOTTE: "bg-lotte", MEGA: "bg-mega", INDIE: "bg-[#555]" };

export interface PeekTarget {
  movieTitle: string;
  /** 특정 배지를 눌렀으면 그 종류만, "특전 N종" 요약을 눌렀으면 null(전체) */
  type: string | null;
  /** 특정 극장 줄에서 눌렀으면 그 지점명 (헤더 표기용) */
  theaterName?: string;
  /** [chain, previews] 목록 — 요약 클릭 시 여러 체인 */
  entries: { chain: string; previews: EventPreview[] }[];
}

/**
 * 특전 종류 배지 클릭 → 이벤트 배너 이미지 미리보기 모달.
 * 굿즈 개별 이미지가 없어 이벤트 배너로 대신한다 (롯데·메가 제공, CGV 미제공).
 */
export default function EventPeek({ target, onClose }: { target: PeekTarget; onClose: () => void }) {
  // ESC 닫기 + 배경 스크롤 잠금
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const items = target.entries.flatMap(({ chain, previews }) =>
    previews
      .filter((p) => target.type === null || p.type === target.type)
      .map((p) => ({ chain, ...p }))
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-[420px] max-h-[82dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 flex items-center gap-2 border-b border-line bg-panel/95 backdrop-blur-sm px-4 py-3">
          <div className="min-w-0">
            <b className="block truncate text-[14px]">{target.movieTitle}</b>
            <span className="text-[11px] text-ink-3">
              특전 미리보기
              {target.theaterName ? ` · ${target.theaterName}` : ""}
              {target.type ? ` · ${target.type === "기타" ? "현장이벤트" : target.type}` : ""}
            </span>
          </div>
          <button
            onClick={onClose}
            className="ml-auto flex h-7 w-7 flex-none items-center justify-center rounded-full bg-ground text-[13px] text-ink-2"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/* 이벤트 목록 */}
        <div className="flex flex-col gap-3 p-4">
          {items.length === 0 && (
            <p className="py-6 text-center text-xs text-ink-3">해당 특전 정보를 찾지 못했어요</p>
          )}
          {items.map((it, i) => (
            <div key={i} className="rounded-xl border border-line overflow-hidden">
              <div className="flex items-center gap-1.5 px-3 py-2">
                <span className={`rounded-[5px] px-1.5 py-0.5 text-[10px] font-bold text-white ${CHAIN_CLASS[it.chain] ?? "bg-ink-3"}`}>
                  {CHAIN_LABEL[it.chain] ?? it.chain}
                </span>
                <span className={`rounded-[5px] border px-1.5 py-0.5 text-[10px] font-bold ${GOODIE_BADGE_CLASS}`}>
                  {it.type === "기타" ? "현장이벤트" : it.type}
                </span>
                {it.theaterIds.length === 0 && (
                  <span
                    className="rounded-[5px] border border-line bg-ground px-1.5 py-0.5 text-[10px] text-ink-3"
                    title="이 이벤트는 지점 데이터가 제공되지 않아 진행 지점을 확인할 수 없어요"
                  >
                    지점 미확인
                  </span>
                )}
                <span className="ml-auto text-[10.5px] text-ink-3 tabular-nums">
                  {it.startDate.slice(5).replace("-", "/")}~{it.endDate.slice(5).replace("-", "/")}
                </span>
              </div>
              <div className="flex items-start gap-2 px-3 pb-2">
                <p className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug">{it.eventName}</p>
                {it.sourceUrl && (
                  <a
                    href={it.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-none rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold text-ink-2 hover:border-app hover:text-app transition-colors"
                  >
                    원문 ↗
                  </a>
                )}
              </div>
              {/* 실물 도안(상세 본문) 우선 → 없으면 홍보 배너 → 그것도 없으면 안내 */}
              {it.detailImages.length > 0 ? (
                it.detailImages.map((src, j) => (
                  <img
                    key={j}
                    src={src}
                    alt={`${it.eventName} 특전 이미지 ${j + 1}`}
                    loading="lazy"
                    className="w-full bg-ground object-contain"
                  />
                ))
              ) : it.imageUrl ? (
                <>
                  <img
                    src={it.imageUrl}
                    alt={it.eventName}
                    loading="lazy"
                    className="w-full bg-ground object-contain"
                  />
                  <p className="border-t border-line-soft bg-ground px-3 py-1.5 text-[10.5px] text-ink-3">
                    ⓘ 홍보 배너 이미지 — 실물 도안 미수집
                  </p>
                </>
              ) : (
                <div className="flex items-center justify-center gap-1.5 border-t border-line-soft bg-ground py-5 text-[11.5px] text-ink-3">
                  🖼️ {CHAIN_LABEL[it.chain] ?? it.chain} 특전 이미지 미제공
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
