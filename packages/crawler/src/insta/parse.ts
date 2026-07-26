/**
 * 인스타 공지 → 특전 구조화 파서
 *
 * 계약(설계서 ⑤): 이미지 + 캡션 → {isGoodieEvent, movieTitle, goodies, 기간, conditions, confidence}
 * 구현체는 교체 가능하게 인터페이스로 분리 — v1은 Gemini Flash (무료 티어),
 * 품질 미달 시 Claude 등으로 스위치.
 */

export interface ParsedGoodie {
  name: string;
  /** 포스터 | TTT | OT | 엽서 | 스티커 | 기타 등 — 자유 서술, ingest에서 classify */
  type: string;
}

export interface ParsedGoodiePost {
  /** 특전(굿즈 "증정") 공지인가 — 판매(MD)·상영시간표·인사글·단순 개봉 소식은 false */
  isGoodieEvent: boolean;
  /** 게시물 분류 — 특전 | 상영회 | 영화 | 극장 | 기타 */
  category: string;
  /** 게시물 한 줄 제목 (피드 카드용, 25자 이내) */
  summary: string;
  movieTitle: string | null;
  /** 캡션/이미지에 감독명이 있으면 (동명 영화 구분용 — 예: "폴 토마스 앤더슨") */
  director: string | null;
  /** 캡션/이미지에 제작·개봉 연도가 있으면 (동명 영화 구분용) */
  year: number | null;
  goodies: ParsedGoodie[];
  /** YYYY-MM-DD, 공지에 명시된 경우만 */
  startDate: string | null;
  endDate: string | null;
  /** 수령 조건 원문 요약 ("개봉 첫주 관람객", "재관람 시" 등) */
  conditions: string | null;
  /** 0~1 — 파싱 확신도 */
  confidence: number;
}

export interface GoodiePostParser {
  parse(input: { imageUrls: string[]; caption: string }): Promise<ParsedGoodiePost>;
}

// ── Gemini 구현 ──────────────────────────────────

// 별칭 사용 — 특정 버전은 신규 계정에 막히는 경우가 있음 ("no longer available to new users")
export const GEMINI_MODEL = "gemini-flash-latest";
// 주 모델 무료 쿼터(하루 20회 수준) 소진 시 폴백 — 쿼터가 분리돼 있음 (2026-07-25 실측)
export const GEMINI_FALLBACK_MODEL = "gemini-flash-lite-latest";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    isGoodieEvent: { type: "BOOLEAN" },
    category: { type: "STRING", enum: ["특전", "상영회", "영화", "극장", "기타"] },
    summary: { type: "STRING" },
    movieTitle: { type: "STRING", nullable: true },
    director: { type: "STRING", nullable: true },
    year: { type: "NUMBER", nullable: true },
    goodies: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { name: { type: "STRING" }, type: { type: "STRING" } },
        required: ["name", "type"],
      },
    },
    startDate: { type: "STRING", nullable: true },
    endDate: { type: "STRING", nullable: true },
    conditions: { type: "STRING", nullable: true },
    confidence: { type: "NUMBER" },
  },
  required: ["isGoodieEvent", "category", "summary", "goodies", "confidence"],
} as const;

const PROMPT = `당신은 한국 독립영화관의 인스타그램 공지를 분석하는 파서입니다.
첨부된 이미지(공지 포스터)와 캡션을 읽고 아래를 판단하세요.

1. isGoodieEvent: 이 게시물이 "영화 관람 시 굿즈/특전을 **증정**"하는 공지인가?
   - true 예: 관람객에게 포스터, 엽서, 스티커, 오리지널 티켓, 티켓북, 뱃지 등을 무료 증정
   - false 예: 굿즈 **판매/입고/구매**(MD샵), 단순 개봉/상영 소식, 상영시간표, GV/무대인사(굿즈 없음), 극장 인사글, 할인 공지
   - ⚠️ "증정"과 "판매"를 반드시 구분하세요. 돈 주고 사는 것은 특전이 아닙니다.
2. category: 게시물 분류 —
   - 특전: 관람 특전 증정 (isGoodieEvent=true와 일치)
   - 상영회: GV, 무대인사, 특별상영, 시네마톡, 관객과의 대화
   - 영화: 개봉/상영/종영 소식, 작품 소개
   - 극장: 극장 자체 소식 (상영시간표, 휴관, MD 판매, 멤버십 등)
   - 기타: 위 어디에도 안 맞음
3. summary: 게시물을 한 줄로 요약한 제목 (25자 이내, 예: "<콜럼버스> 종영 기념 포스터 4종 증정")
4. movieTitle: 대상 영화의 한국어 제목 (영화가 특정되면 분류와 무관하게 기입)
   - director: 감독명이 언급되어 있으면 기입 (예: "폴 토마스 앤더슨"). 없으면 null
   - year: 제작·개봉 연도가 언급되어 있으면 기입 (예: 1997). 없으면 null
5. goodies: **증정** 굿즈 목록 (판매 상품은 제외). type은 포스터/엽서/스티커/OT/TTT/티켓북/뱃지/기타
6. startDate/endDate: 공지에 명시된 기간 (YYYY-MM-DD). 연도가 없으면 2026년으로 가정. 명시 없으면 null
7. conditions: 수령 조건 요약 ("개봉 첫주 관람객 선착순", "예매 인증 시" 등). 없으면 null
8. confidence: 위 추출의 전체 확신도 0~1. 이미지가 흐리거나 정보가 모호하면 낮게.

캡션:
`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Gemini generateContent 공용 호출 — responseSchema 강제 JSON + 429 대응.
 * 무료 티어 쿼터 정책 (2026-07-25 실측):
 *   - 주 모델(flash)은 하루 20회 수준으로 짜다 → 429 재시도 2회 후 lite 모델로 폴백
 *   - lite는 쿼터가 분리돼 있어 대량 작업(시드)도 소화 가능
 */
export async function geminiGenerate<T>(parts: object[], responseSchema: object): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 환경변수 누락");

  let lastErr: Error | null = null;
  for (const model of [GEMINI_MODEL, GEMINI_FALLBACK_MODEL]) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema,
              temperature: 0.1,
            },
          }),
          signal: AbortSignal.timeout(60_000),
        }
      );
      if (res.status === 429) {
        const body = await res.text();
        const waitSec = Number(body.match(/retry in ([\d.]+)s/i)?.[1] ?? 25);
        lastErr = new Error(`Gemini 429 (${model})`);
        // 대기가 길면 이 모델 쿼터는 소진으로 보고 바로 다음 모델로
        if (attempt < 2 && waitSec <= 30) await sleep(Math.ceil(waitSec + 2) * 1000);
        else break;
        continue;
      }
      if (res.status === 503) {
        // 과부하 — 같은 모델 1회 재시도 후 다음 모델
        lastErr = new Error(`Gemini 503 (${model})`);
        if (attempt < 2) await sleep(10_000);
        continue;
      }
      if (!res.ok) {
        throw new Error(`Gemini API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      if (model !== GEMINI_MODEL) console.log(`    (Gemini 폴백 모델 사용: ${model})`);
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Gemini 응답에 텍스트 없음");
      return JSON.parse(text) as T;
    }
  }
  throw lastErr ?? new Error("Gemini 호출 실패");
}

/**
 * Gemini 비전 호출 공용부 — 이미지들 + 프롬프트 → responseSchema 강제 JSON.
 * (특전 파서·시간표 파서가 공유)
 */
export async function callGeminiVision<T>(
  imageUrls: string[],
  prompt: string,
  responseSchema: object,
  maxImages = 3
): Promise<T> {
  // 이미지 다운로드 → base64 인라인
  const parts: object[] = [];
  for (const url of imageUrls.slice(0, maxImages)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) continue;
    const mime = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
    parts.push({ inlineData: { mimeType: mime, data: b64 } });
  }
  if (parts.length === 0) throw new Error("파싱할 이미지 없음");
  parts.push({ text: prompt });
  return geminiGenerate<T>(parts, responseSchema);
}

export class GeminiParser implements GoodiePostParser {
  async parse(input: { imageUrls: string[]; caption: string }): Promise<ParsedGoodiePost> {
    const parsed = await callGeminiVision<ParsedGoodiePost>(
      input.imageUrls,
      PROMPT + (input.caption || "(캡션 없음)"),
      RESPONSE_SCHEMA
    );
    // 방어: 필드 기본값
    return {
      isGoodieEvent: !!parsed.isGoodieEvent,
      category: parsed.category ?? "기타",
      summary: parsed.summary ?? "",
      movieTitle: parsed.movieTitle ?? null,
      director: parsed.director ?? null,
      year: typeof parsed.year === "number" ? parsed.year : null,
      goodies: parsed.goodies ?? [],
      startDate: parsed.startDate ?? null,
      endDate: parsed.endDate ?? null,
      conditions: parsed.conditions ?? null,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  }
}

/** 기본 파서 (교체 지점) */
export function getParser(): GoodiePostParser {
  return new GeminiParser();
}
