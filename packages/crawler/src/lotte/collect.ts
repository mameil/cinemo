/**
 * 롯데시네마 → 정규화(collect)
 *
 * 굿즈 이벤트(카테고리 20) 목록을 주 소스로 사용한다:
 *   fetchGoodsEvents → fetchEventDetail (영화 연결)
 *                    → fetchGoodsGiftItems (굿즈 목록)
 *                    → fetchCinemaGoods (지점별 잔여 수량)
 *
 * 2026-07-15: GetCinemaGoods API 발견 → 지점별 잔여 수량(Cnt) 수집 추가.
 *   이벤트 상세의 GoodsGiftItems[].FrGiftID를 키로 GetCinemaGoods 호출.
 */

import type { CollectedEvent, CollectedGoodie, CollectedStock, StockStatus } from "../domain";
import {
  buildImageUrl,
  fetchGoodsEvents,
  fetchEventList,
  fetchEventDetail,
  fetchGoodsGiftItems,
  fetchCinemaGoods,
  type LotteEvent,
} from "./api";

/** 롯데 분류 코드 → 정규화 카테고리 (이벤트 피드용) */
const LOTTE_CATEGORY: Record<string, string> = {
  "10": "영화", // 리미티드 (영화 연계)
  "30": "극장", // 우리동네영화관
  "40": "상영회", // 시사회/무대인사
  "50": "제휴", // 제휴할인
};

export interface LotteCollectOptions {
  /** 수집할 굿즈 이벤트 최대 개수 (미지정 시 전체) */
  maxEvents?: number;
  /** true면 일반 이벤트(분류 10~50) 수집 생략 — 3h 크론용 */
  skipGeneral?: boolean;
}

/** YYYY.MM.DD → YYYY-MM-DD */
function formatYmd(ymd: string): string {
  const m = ymd.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return ymd;
}

/**
 * 이벤트명에서 영화 제목 태그를 추출한다.
 * 롯데는 <영화명> (꺾쇠) 관례가 우세하고 일부 [영화명] 도 있어 둘 다 시도한다.
 * 예: "<호프> 얼리버드 이벤트" → "호프"
 */
function tagTitle(s: string): string | undefined {
  const raw = s.match(/<([^>]+)>/)?.[1] ?? s.match(/\[([^\]]+)\]/)?.[1] ?? null;
  if (!raw) return undefined;
  const t = raw.replace(/\s*(?:…|\.\.\.)\s*$/, "").trim(); // 끝 잘림 표시 제거
  return t || undefined;
}

/** Cnt → StockStatus 변환 */
function cntToStatus(cnt: number): StockStatus {
  if (cnt <= 0) return "소진";
  if (cnt <= 30) return "소량보유";
  return "보유";
}

/** 롯데 굿즈 이벤트를 정규화된 CollectedEvent[]로 수집 */
export async function collectLotte(
  opts: LotteCollectOptions = {}
): Promise<CollectedEvent[]> {
  // 1. 굿즈 이벤트 목록 (카테고리 20)
  const events: LotteEvent[] = await fetchGoodsEvents();
  const limited = opts.maxEvents ? events.slice(0, opts.maxEvents) : events;

  // 2. 이벤트별 상세 + 굿즈 + 재고 수집
  const result: CollectedEvent[] = [];
  for (const ev of limited) {
    const detail = await fetchEventDetail(ev.EventID).catch(() => null);

    // 영화 제목: 상세 MovieName 우선, 없으면 이벤트명의 <꺾쇠>/[대괄호] 태그
    const movieTitle: string | undefined =
      detail?.MovieName?.trim() || tagTitle(ev.EventName);

    // 이미지: 목록 ImageUrl 우선, 없으면 상세 ImageUrl
    const imagePath = ev.ImageUrl || detail?.ImageUrl || "";
    const imageUrl = imagePath ? buildImageUrl(imagePath) : undefined;

    // 상세 본문 이미지 = 굿즈 실물 도안 (목록 배너 324px와 달리 앞/뒷면이 그려진 세로 콘텐츠 이미지).
    // 상세 API의 ImageUrl이 목록과 다르면 그것이 본문 이미지다.
    const detailPath = detail?.ImageUrl || "";
    const detailImageUrl =
      detailPath && detailPath !== ev.ImageUrl ? buildImageUrl(detailPath) : undefined;
    const detailImageUrls = detailImageUrl ? [detailImageUrl] : undefined;

    // 3. 굿즈 목록 (GoodsGiftItems) 수집
    let giftItems = await fetchGoodsGiftItems(ev.EventID).catch(() => []);
    const goodies: CollectedGoodie[] = [];

    for (const gift of giftItems) {
      // 4. 지점별 재고 수집
      const cinemaGoods = await fetchCinemaGoods(ev.EventID, gift.FrGiftID).catch(() => []);

      const stock: CollectedStock[] = cinemaGoods.map((c) => ({
        branchCode: String(c.CinemaID),
        branchName: c.CinemaNameKR,
        region: c.DetailDivisionNameKR,
        status: cntToStatus(c.Cnt),
        remainingQty: c.Cnt,
      }));

      goodies.push({
        name: gift.FrGiftNm,
        sourceGoodsId: gift.FrGiftID,
        stock,
      });
    }

    result.push({
      chain: "LOTTE",
      sourceEventId: ev.EventID,
      eventName: ev.EventName,
      startDate: formatYmd(ev.ProgressStartDate),
      endDate: formatYmd(ev.ProgressEndDate),
      sourceUrl: `https://www.lottecinema.co.kr/NLCHS/Event/EventTemplateInfo?EventID=${ev.EventID}`,
      imageUrl,
      detailImageUrls,
      category: "특전",
      movieTitle,
      goodies,
      raw: { event: ev, detail, giftItems },
    });
  }

  // 5. 일반 이벤트 (굿즈 외 분류) — 이벤트 피드용. 3h 크론에선 생략 (하루 2회 풀 크롤)
  if (opts.skipGeneral) return result;
  let generalAdded = 0;
  for (const [code, category] of Object.entries(LOTTE_CATEGORY)) {
    let list: LotteEvent[] = [];
    try {
      list = (await fetchEventList(code)).Items;
    } catch (err) {
      console.error(`  ⚠️ 롯데 일반 이벤트(분류 ${code}) 실패: ${(err as Error).message}`);
      continue;
    }
    for (const ev of list) {
      if (opts.maxEvents && generalAdded >= opts.maxEvents) break;

      // 상세 본문 이미지 — 목록 썸네일(324px)과 달리 내용이 담긴 세로 이미지.
      // 굿즈 이벤트와 같은 규칙: 상세 ImageUrl이 목록과 다르면 그것이 본문.
      const detail = await fetchEventDetail(ev.EventID).catch(() => null);
      const detailPath = detail?.ImageUrl || "";
      const detailImageUrl =
        detailPath && detailPath !== ev.ImageUrl ? buildImageUrl(detailPath) : undefined;

      result.push({
        chain: "LOTTE",
        sourceEventId: ev.EventID,
        eventName: ev.EventName,
        startDate: formatYmd(ev.ProgressStartDate),
        endDate: formatYmd(ev.ProgressEndDate),
        sourceUrl: `https://www.lottecinema.co.kr/NLCHS/Event/EventTemplateInfo?EventID=${ev.EventID}`,
        imageUrl: ev.ImageUrl ? buildImageUrl(ev.ImageUrl) : undefined,
        detailImageUrls: detailImageUrl ? [detailImageUrl] : undefined,
        category,
        movieTitle: tagTitle(ev.EventName),
        linkMovieOnly: true, // 비영화 제목이 movies를 오염시키지 않게
        goodies: [],
        raw: { event: ev, detail },
      });
      generalAdded++;
    }
  }
  console.log(`  롯데 일반 이벤트 수집: ${generalAdded}건`);

  return result;
}
