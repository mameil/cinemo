/**
 * 독립영화관 공식 시간표 오케스트레이터.
 *
 * 극장별 수집 실패를 격리해 한 곳의 장애가 다른 독립관 회차를 막지 않게 한다.
 * 공식 소스를 하나씩 추가하며, 인스타 시간표는 별도 폴백으로 유지한다.
 */

import type { CollectedScreening } from "../domain";
import { collectArirangScreenings } from "./arirang";
import { collectCinecubeScreenings } from "./cinecube";
import { collectDeosupScreenings } from "./deosup";
import { collectEmuScreenings } from "./emu";
import { collectFilmforumScreenings } from "./filmforum";
import { collectIndiespaceScreenings } from "./indiespace";
import { collectKuScreenings } from "./ku";
import { collectLaikaScreenings } from "./laika";
import { collectMomoScreenings } from "./momo";
import { collectSangsangScreenings } from "./sangsang";
import { collectSeoulArtCinemaScreenings } from "./seoulartcinema";

interface IndieSource {
  label: string;
  collect: (options: { days?: number }) => Promise<CollectedScreening[]>;
}

const SOURCES: IndieSource[] = [
  { label: "라이카시네마", collect: collectLaikaScreenings },
  // 아트나인: 동작구라 커버 범위 밖 → 추적 제외(2026-08-09, INDIE_THEATERS에서 삭제).
  { label: "KT&G 상상마당 시네마", collect: collectSangsangScreenings },
  { label: "KU시네마테크", collect: collectKuScreenings },
  { label: "아리랑시네센터", collect: collectArirangScreenings },
  { label: "씨네큐브", collect: collectCinecubeScreenings },
  { label: "더숲 아트시네마", collect: collectDeosupScreenings },
  { label: "에무시네마", collect: collectEmuScreenings },
  { label: "필름포럼", collect: collectFilmforumScreenings },
  { label: "인디스페이스", collect: collectIndiespaceScreenings },
  { label: "아트하우스 모모", collect: collectMomoScreenings },
  { label: "서울아트시네마", collect: collectSeoulArtCinemaScreenings },
];

export async function collectIndieScreenings(options: {
  days?: number;
  only?: string[];
} = {}): Promise<CollectedScreening[]> {
  const result: CollectedScreening[] = [];
  const failures: string[] = [];

  for (const source of SOURCES) {
    try {
      result.push(...await source.collect({ days: options.days }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${source.label}: ${message}`);
      console.error(`  ⚠️ ${source.label} 공식 시간표 실패: ${message}`);
    }
  }

  if (failures.length === SOURCES.length) {
    throw new Error(`독립관 공식 시간표 전체 실패 — ${failures.join(" / ")}`);
  }
  return result;
}
