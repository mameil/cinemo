/**
 * 메가박스 → 정규화(collect)
 *
 * 영화 탭 흐름을 주 소스로 사용한다:
 *   fetchEventList → fetchEventGoods → fetchGoodsStock
 * 이벤트/굿즈명의 선두 대괄호([영화명])에서 영화 제목을 best-effort로 추출한다.
 *
 * 한계:
 * - 메가박스는 지점별 잔여/총 수량을 제공하지 않고 상태값(보유/소량보유/소진)만 준다.
 *   → remainingQty/totalQty는 채우지 않는다(undefined).
 * - status에 "준비중"이 있으나 우리 StockStatus union에 없으므로 해당 항목은 제외한다.
 */

import type {
  CollectedEvent,
  CollectedGoodie,
  CollectedStock,
  StockStatus,
} from "../domain";
import {
  fetchEventList,
  fetchEventGoods,
  fetchGoodsStock,
  formatDate,
  type MegaboxEventItem,
  type MegaboxStockItem,
} from "./api";

export interface MegaboxCollectOptions {
  /** 수집할 이벤트 최대 개수 (미지정 시 전체) */
  maxEvents?: number;
  /** 페이지당 개수 */
  pageSize?: number;
}

/** "YYYY.MM.DD" → "YYYY-MM-DD" (이미 변환됐거나 형식이 다르면 그대로) */
function toIsoDate(date: string): string {
  if (/^\d{4}\.\d{2}\.\d{2}$/.test(date)) return formatDate(date);
  return date;
}

/** 우리 StockStatus union에 속하는 상태만 통과 ("준비중" 등 제외) */
function isKnownStatus(status: string): status is StockStatus {
  return status === "보유" || status === "소량보유" || status === "소진";
}

/**
 * 영화 제목 추출.
 * 메가박스는 영화명을 <꺾쇠>로 감싼다 (예: "<마티 슈프림> 스페셜 굿즈...").
 * 선두 [대괄호]는 굿즈 카테고리([굿즈패키지] 등)이므로 사용하지 않는다.
 * 굿즈명에서는 꺾쇠가 HTML 엔티티(&lt;&gt;)로 남아있을 수 있어 함께 처리한다.
 */
function angleTitle(s: string): string | undefined {
  const raw =
    s.match(/<([^>]+)>/)?.[1] ?? s.match(/&lt;(.+?)&gt;/)?.[1] ?? null;
  if (!raw) return undefined;
  const t = raw.replace(/\s*(?:…|\.\.\.)\s*$/, "").trim();
  return t || undefined;
}

/** 이벤트명 → 굿즈명 순으로 영화 제목을 best-effort 추출 */
function extractMovieTitle(
  eventTitle: string,
  goodsNames: string[]
): string | undefined {
  const fromEvent = angleTitle(eventTitle);
  if (fromEvent) return fromEvent;
  for (const name of goodsNames) {
    const fromGoods = angleTitle(name);
    if (fromGoods) return fromGoods;
  }
  return undefined;
}

/** 메가박스 소진현황 → CollectedStock (수량 없음, 준비중은 상위에서 제외) */
function mapStock(s: MegaboxStockItem & { status: StockStatus }): CollectedStock {
  return {
    branchCode: s.branchCode,
    branchName: s.branchName,
    region: s.regionName,
    status: s.status,
  };
}

/** 메가박스 영화 탭 + 메가pick 탭 이벤트를 정규화된 CollectedEvent[]로 수집 */
export async function collectMegabox(
  opts: MegaboxCollectOptions = {}
): Promise<CollectedEvent[]> {
  const pageSize = opts.pageSize ?? 100;

  // 1. 이벤트 목록 (영화 탭 CED01 + 메가pick 탭 CED03, 중복 제거)
  const tabs: Array<{ code: string; label: string }> = [
    { code: "CED01", label: "영화" },
    { code: "CED03", label: "메가pick" },
  ];

  const seen = new Set<string>();
  const megaEvents: MegaboxEventItem[] = [];

  for (const tab of tabs) {
    let page = 1;
    const first = await fetchEventList(page, pageSize, tab.code);
    const tabTotal = opts.maxEvents
      ? Math.min(first.totalCount, opts.maxEvents)
      : first.totalCount;

    const tabEvents = [...first.list];
    while (tabEvents.length < tabTotal) {
      page += 1;
      const next = await fetchEventList(page, pageSize, tab.code);
      if (!next.list.length) break;
      tabEvents.push(...next.list);
    }

    let added = 0;
    for (const ev of tabEvents.slice(0, tabTotal)) {
      if (!seen.has(ev.eventNo)) {
        seen.add(ev.eventNo);
        megaEvents.push(ev);
        added++;
      }
    }
    console.log(`  [메가박스] ${tab.label} 탭: ${added}건`);
  }

  const limited = opts.maxEvents
    ? megaEvents.slice(0, opts.maxEvents)
    : megaEvents;

  // 2. 이벤트별 굿즈 + 소진현황
  const result: CollectedEvent[] = [];
  let skipped = 0;
  for (const ev of limited) {
    // 이벤트 하나가 실패해도 전체 배치가 죽지 않도록 개별 격리
    try {
      const { goods: goodsInfos, detailImageUrls } = await fetchEventGoods(ev.eventNo);

      const goodies: CollectedGoodie[] = [];
      const rawStocks: Record<string, MegaboxStockItem[]> = {};
      for (const gi of goodsInfos) {
        const { stock } = await fetchGoodsStock(ev.eventNo, gi.goodsNo);
        rawStocks[gi.goodsNo] = stock;

        const mapped: CollectedStock[] = stock
          .filter((s): s is MegaboxStockItem & { status: StockStatus } =>
            isKnownStatus(s.status)
          )
          .map(mapStock);

        goodies.push({
          name: gi.goodsName.trim(),
          sourceGoodsId: gi.goodsNo,
          stock: mapped,
        });
      }

      // 카테고리: 굿즈 있으면 특전, 없으면 이름으로 상영회/영화 구분
      const category =
        goodies.length > 0
          ? "특전"
          : /상영회|GV|무대인사|시사회|라이브뷰잉/.test(ev.eventTitle)
            ? "상영회"
            : "영화";

      result.push({
        chain: "MEGA",
        sourceEventId: ev.eventNo,
        eventName: ev.eventTitle,
        startDate: toIsoDate(ev.startDate),
        endDate: toIsoDate(ev.endDate),
        sourceUrl: `https://www.megabox.co.kr/event/detail?eventNo=${ev.eventNo}`,
        imageUrl: ev.imageUrl || undefined,
        detailImageUrls: detailImageUrls.length ? detailImageUrls : undefined,
        category,
        movieTitle: extractMovieTitle(
          ev.eventTitle,
          goodsInfos.map((g) => g.goodsName)
        ),
        // 굿즈 없는 일반 이벤트(콘서트·라이브뷰잉 등)는 기존 영화에만 연결
        linkMovieOnly: goodies.length === 0,
        goodies,
        raw: { event: ev, goods: goodsInfos, stocks: rawStocks },
      });
    } catch (err) {
      skipped++;
      console.error(
        `  ⚠️ 이벤트 스킵 [${ev.eventNo}] ${ev.eventTitle}: ${(err as Error).message}`
      );
    }
  }
  if (skipped) console.error(`  (총 ${skipped}개 이벤트 스킵됨)`);

  return result;
}
