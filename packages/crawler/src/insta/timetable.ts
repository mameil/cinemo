/**
 * 인스타 시간표 이미지 → 구조화 상영 회차 (설계서 2026-07-24 실증 후속)
 *
 * 독립영화관은 주간 상영시간표를 인스타 이미지로 공지한다.
 * 특전 파서가 "극장"으로 분류한 게시물에 한해 2차 호출로 회차를 추출,
 * 기존 screenings 파이프라인(ingestScreenings)에 흘려보낸다.
 *
 * 실증(라이카 7/22~28): 이미지 2장 → 76회차 전량 추출, 부가 표기까지 정확.
 */

import { callGeminiVision } from "./parse";

export interface TimetableEntry {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (24h)
  movieTitle: string;
  note: string | null; // GV / Dolby Atmos / 특별 상영 / 굿즈 패키지 상영회 등
}

export interface ParsedTimetable {
  isTimetable: boolean;
  screenings: TimetableEntry[];
  confidence: number;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    isTimetable: { type: "BOOLEAN" },
    screenings: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING" },
          time: { type: "STRING" },
          movieTitle: { type: "STRING" },
          note: { type: "STRING", nullable: true },
        },
        required: ["date", "time", "movieTitle"],
      },
    },
    confidence: { type: "NUMBER" },
  },
  required: ["isTimetable", "screenings", "confidence"],
} as const;

const PROMPT = `첨부 이미지는 한국 독립영화관의 주간 상영시간표(로 추정되는 공지)입니다.
표에 있는 **모든 회차**를 하나도 빠짐없이 추출하세요.
- date: 열/행에 표시된 날짜 (YYYY-MM-DD, 연도가 없으면 2026년)
- time: 상영 시작 시각 (24시간 HH:MM)
- movieTitle: 영화 제목 (줄임 없이 원문대로)
- note: GV/관객과의대화/자막해설/특별상영/Dolby Atmos 등 부가 표기 (없으면 null)
- 상영시간표가 아니면 isTimetable=false, screenings=[]
- confidence: 표를 얼마나 정확히 읽었는지 0~1. 흐리거나 일부만 보이면 낮게.

캡션:
`;

/** 시간표 이미지 → 회차 목록 (시간표가 아니면 isTimetable=false) */
export async function parseTimetable(input: {
  imageUrls: string[];
  caption: string;
}): Promise<ParsedTimetable> {
  const parsed = await callGeminiVision<ParsedTimetable>(
    input.imageUrls,
    PROMPT + (input.caption || "(캡션 없음)"),
    RESPONSE_SCHEMA,
    4 // 시간표는 2장 이상 나뉘는 경우가 흔함
  );
  return {
    isTimetable: !!parsed.isTimetable,
    screenings: (parsed.screenings ?? []).filter(
      (s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && /^\d{2}:\d{2}$/.test(s.time) && s.movieTitle
    ),
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
  };
}

/** 부가 표기 → screenings.format 값 (돌비만 정식 포맷, 상영회류는 원문 유지) */
export function noteToFormat(note: string | null): string | undefined {
  if (!note) return undefined;
  if (/dolby|돌비/i.test(note)) return "돌비 애트모스";
  if (/^개봉/.test(note.trim())) return undefined; // 포맷이 아닌 단순 개봉작 표기
  return note;
}
