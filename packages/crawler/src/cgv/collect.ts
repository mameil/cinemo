/**
 * CGV → 정규화(collect)
 *
 * 특전(saprm) 흐름을 주 소스로 사용한다:
 *   fetchSaprmEventList → fetchSaprmProducts → fetchStockBySite
 * 이벤트/상품명의 선두 대괄호([영화명])에서 영화 제목을 best-effort로 추출한다.
 *
 * 한계: saprm 응답에는 이벤트/굿즈 이미지 필드가 없어 imageUrl은 비운다.
 *       (영화 대표 이미지는 TMDB 포스터 백필로 채움)
 *
 * 상세 이미지(detailImageUrls): saprm과 별개인 일반 이벤트(영화 카테고리 01)에
 * 같은 특전의 홍보 이벤트가 올라온다 (예: saprm "[모아나] TTT" ↔ 일반 "[모아나] TTT").
 * 이름 매칭 후 일반 이벤트 상세의 본문 이미지(evntImfile)를 가져온다 — TTT 앞/뒷면 등 실물 도안.
 */

import type {
  CollectedEvent,
  CollectedGoodie,
  CollectedStock,
  StockStatus,
} from "../domain";
import {
  fetchEventList,
  fetchEventDetail,
  fetchSaprmEventList,
  fetchSaprmProducts,
  fetchStockBySite,
  type CgvEventItem,
  type CgvSaprmProduct,
  type CgvStockItem,
} from "./api";
import { getKnownCgvGoods } from "../db/repo";

export interface CgvCollectOptions {
  /** 수집할 특전 이벤트 최대 개수 (미지정 시 전체) */
  maxEvents?: number;
  /** 페이지당 개수 */
  pageSize?: number;
  /** true면 일반 이벤트 자체 수집 생략 (특전 이미지 매칭용 로드는 유지) — 3h 크론용 */
  skipGeneral?: boolean;
  /**
   * saprmEvntNo → 기존 굿즈 {name, spmtlNo}[]. CGV가 2026-08 상품목록 API를
   * 폐기해 spmtlNo 신규 발견이 불가하므로, 이미 DB에 있는 spmtlNo로 재고만 갱신한다.
   * 미지정 시 collectCgv가 DB에서 직접 조회 (getKnownCgvGoods).
   */
  knownGoods?: Map<string, { name: string; spmtlNo: string }[]>;
}

/** YYYYMMDD → YYYY-MM-DD */
function formatYmd(ymd: string): string {
  if (/^\d{8}$/.test(ymd)) {
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  }
  return ymd;
}

/** 신규 재고 상태(inventStatus 색상) → 소진 상태.
 *  green=보유. 그 외(gray 등)는 보수적으로 소진 처리 — "소진인데 보유로 오노출"이
 *  "보유인데 소진으로 미노출"보다 사용자에게 더 해롭기 때문. */
function statusFromInvent(inventStatus: string): StockStatus {
  return inventStatus === "green" ? "보유" : "소진";
}

/** 문자열 선두의 [대괄호] 내용을 추출 (잘림 표시 …/... 정리) */
function bracketTitle(s: string): string | null {
  const m = s.match(/\[([^\]]+)\]/);
  if (!m) return null;
  const t = m[1]
    .trim()
    .replace(/\s*(?:…|\.\.\.)\s*$/, "") // 끝 잘림 표시 제거
    .trim();
  return t || null;
}

/** 잘림 표시가 있는지 */
function isTruncated(s: string | null): boolean {
  return !!s && /(?:…|\.\.\.)/.test(s);
}

/**
 * 영화 제목 추출 (best-effort).
 * 이벤트명의 [태그]가 잘리지 않았으면 우선 사용, 아니면 상품명에서 시도.
 */
function extractMovieTitle(
  eventName: string,
  products: CgvSaprmProduct[]
): string | undefined {
  const rawEventTag = eventName.match(/\[([^\]]+)\]/)?.[1] ?? null;
  const fromEvent = bracketTitle(eventName);
  if (fromEvent && !isTruncated(rawEventTag)) return fromEvent;

  for (const p of products) {
    const name = p.spmtlProdNm || p.onlnExpoNm || "";
    const rawProdTag = name.match(/\[([^\]]+)\]/)?.[1] ?? null;
    const fromProd = bracketTitle(name);
    if (fromProd && !isTruncated(rawProdTag)) return fromProd;
  }
  return fromEvent ?? undefined;
}

// ── 일반 이벤트 매칭 (상세 이미지용) ──────────────

/**
 * 이름 정규화 (매칭용): 소문자 + SX↔SCREENX 별칭 통일 + 특수문자 제거.
 * "[에픽- 엘비스…] IMAX 포스터" ↔ "[에픽: 엘비스…] IMAX 포스터 증정 이벤트" 같은
 * 문장부호 차이를 흡수한다.
 */
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/screenx/g, "sx")
    .replace(/[^0-9a-z가-힣]/g, "");
}

/** 선두 [대괄호] 태그 (영화명) — 정규화해서 반환 */
function bracketTagNorm(s: string): string | null {
  const m = s.match(/\[([^\]]+)\]/);
  return m ? normName(m[1]) : null;
}

/** "N주차" 표기 추출 */
function weekNo(s: string): string | null {
  return s.match(/(\d+)\s*주차/)?.[1] ?? null;
}

/** 상영 포맷 토큰 (정규화된 문자열에서) — 다르면 다른 특전 */
const FORMAT_TOKENS = ["imax", "4dx", "sx", "dolby", "돌비", "mx4d"];
function formatTokens(norm: string): string {
  return FORMAT_TOKENS.filter((t) => norm.includes(t)).sort().join(",");
}

/** 굿즈 종류 토큰 — 겹쳐야 같은 특전으로 본다 */
const TYPE_KEYWORDS = [
  "포스터", "ttt", "오리지널티켓", "일러스트", "카드", "필름", "엽서",
  "스티커", "키링", "뱃지", "배지", "티셔츠", "슬라이드", "포토", "스틸",
  "티켓", // "SX 엑스트라 컬렉션 티켓" ↔ "SCREENX XTRACOLLECTION 티켓" 매칭용
  "언택트톡", // 특별 상영 명칭 — "[호프] 언택트톡 엽서" ↔ "이동진의 언택트톡 앵콜[호프]" 매칭용
];
function typeTokens(norm: string): string[] {
  return TYPE_KEYWORDS.filter((t) => norm.includes(t));
}

/**
 * saprm 특전명 ↔ 일반 이벤트명 매칭 (배열 반환, 우선순위순).
 * 1차: 접두 관계 ("[마티 슈프림] IMAX 포스터" ↔ "… IMAX 포스터 증정 이벤트")
 * 2차: 토큰 매칭 — 영화태그·주차·포맷이 같고 굿즈 종류가 겹치면 어순이 달라도 매칭.
 * 3차: 2차에서 주차만 완화 — 포맷·종류는 반드시 맞아야 함.
 *      (제목만으로 붙이면 "언택트톡 엽서"에 SCREENX 포스터 이미지가 붙는 오매칭 발생 — 2026-07-18)
 */
function matchGeneralEvents(
  saprmName: string,
  generalEvents: CgvEventItem[]
): CgvEventItem[] {
  const target = normName(saprmName);
  if (!target) return [];

  // 1차: 접두 매칭
  const prefixHit = generalEvents.find((e) => {
    const n = normName(e.evntNm);
    return n === target || n.startsWith(target) || target.startsWith(n);
  });
  if (prefixHit) return [prefixHit];

  const tag = bracketTagNorm(saprmName);
  if (!tag) return [];
  const week = weekNo(saprmName);
  const fmt = formatTokens(target);
  const types = typeTokens(target);
  // "현장이벤트/증정"처럼 굿즈 키워드 없는 범용 명칭인가
  const saprmGeneric = /현장|증정/.test(saprmName);
  if (!types.length && !saprmGeneric) return []; // 단서가 아예 없으면 포기

  // 태그·포맷이 맞고 종류가 겹치는 후보 (같은 특전이라고 볼 수 있는 최소 조건)
  const typeOverlap = (e: CgvEventItem) => {
    const n = normName(e.evntNm);
    return types.length > 0 && types.some((t) => n.includes(t));
  };
  const sameTagFmt = (e: CgvEventItem) => {
    const n = normName(e.evntNm);
    return bracketTagNorm(e.evntNm) === tag && formatTokens(n) === fmt;
  };
  // 범용 안내 페이지 매칭: 한쪽이 "현장이벤트/증정" 류 범용명이면, 영화·주차가
  // 정확히 같을 때 그 주차의 특전 안내로 인정한다.
  // (예: saprm "1주차 JODIE FOSTER 파리 포스터" ↔ 일반 "1주차 현장이벤트")
  const genericPair = (e: CgvEventItem) => {
    const genTypes = typeTokens(normName(e.evntNm));
    const genGeneric = genTypes.length === 0 && /현장|증정/.test(e.evntNm);
    return genGeneric || (!types.length && saprmGeneric);
  };

  // 2차: 주차까지 일치 — 종류 겹침 또는 범용 안내 페이지
  const tokenHit = generalEvents.find(
    (e) => sameTagFmt(e) && weekNo(e.evntNm) === week && (typeOverlap(e) || genericPair(e))
  );
  if (tokenHit) return [tokenHit];

  // 3차: 주차만 완화 — 범용 매칭은 불허(오매칭 위험), 종류 겹침 필수
  return generalEvents.filter((e) => sameTagFmt(e) && typeOverlap(e));
}

function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** CGV 콘텐츠 이미지 절대 URL (path + 파일명 → cdn 호스트) */
function buildContentImageUrl(path: string, fnm: string): string {
  const p = path.replace(/^\/+|\/+$/g, "");
  return `https://cdn.cgv.co.kr/${p}/${fnm}`;
}

/**
 * 매칭된 일반 이벤트 상세에서 이미지 추출.
 * evntImfile(대표 이미지)을 우선 사용. HTML 본문 <img>는 evntImfile이 없을 때만
 * 폴백으로 사용 — 본문에 다른 주차 포스터가 섞여 있는 경우를 방지.
 */
async function fetchDetailImages(evntNo: string): Promise<string[]> {
  const detail = (await fetchEventDetail(evntNo)) as {
    evntImfilePhyscFilePathnm?: string | null;
    evntImfilePhyscFnm?: string | null;
    evntHtmlCont?: string | null;
  };

  if (detail.evntImfilePhyscFilePathnm && detail.evntImfilePhyscFnm) {
    return [buildContentImageUrl(detail.evntImfilePhyscFilePathnm, detail.evntImfilePhyscFnm)];
  }

  // evntImfile 없을 때만 HTML 본문에서 첫 번째 이미지 추출 (혼합 방지 위해 1장만)
  const urls: string[] = [];
  for (const m of (detail.evntHtmlCont ?? "").matchAll(/<img[^>]*src="([^"]+)"/g)) {
    const src = m[1].startsWith("http") ? m[1] : `https://cdn.cgv.co.kr/${m[1].replace(/^\/+/, "")}`;
    if (!urls.includes(src)) urls.push(src);
    if (urls.length >= 1) break;
  }
  return urls;
}

/** 일반 이벤트 상세의 진행 극장 siteNo 목록 (기획전 우산 매칭용) */
async function fetchDetailSites(evntNo: string): Promise<string[]> {
  const detail = (await fetchEventDetail(evntNo)) as {
    ctgsiteLst?: { siteNo: string }[] | null;
  };
  return (detail.ctgsiteLst ?? []).map((s) => s.siteNo);
}

function mapStock(s: CgvStockItem): CollectedStock {
  return {
    branchCode: s.siteNo,
    branchName: s.expoSiteNm || s.siteNm,
    region: s.regnGrpNm,
    status: statusFromInvent(s.inventStatus),
    // 신규 응답은 수량을 주지 않음 — remainingQty/totalQty 비움
  };
}

/** CGV 특전 이벤트를 정규화된 CollectedEvent[]로 수집 */
export async function collectCgv(
  opts: CgvCollectOptions = {}
): Promise<CollectedEvent[]> {
  const pageSize = opts.pageSize ?? 50;

  // 기존 spmtlNo 확보 (재고 갱신용) — CGV 상품목록 API 폐기 대응.
  const knownGoods =
    opts.knownGoods ?? (await getKnownCgvGoods().catch(() => new Map()));

  // 1. 특전 이벤트 목록 (페이징)
  const first = await fetchSaprmEventList(0, pageSize);
  const total = opts.maxEvents
    ? Math.min(first.totalCount, opts.maxEvents)
    : first.totalCount;

  const saprmEvents = [...first.list];
  while (saprmEvents.length < total) {
    const page = await fetchSaprmEventList(saprmEvents.length, pageSize);
    if (!page.list.length) break;
    saprmEvents.push(...page.list);
  }
  const limited = saprmEvents.slice(0, total);

  // 1.5 일반 이벤트 목록 — ① saprm과 이름 매칭해 상세 이미지 확보
  //     ② saprm과 매칭 안 된 것은 일반 이벤트로 자체 수집 (이벤트 피드용)
  //     01=영화 · 03=상영회/무대인사 · 04=극장 · 05=제휴/할인. 전체 페이징.
  const generalEvents: CgvEventItem[] = [];
  // skip-general 모드: 특전 이미지 매칭에 필요한 01·03만 로드 (04·05는 일반 수집 전용)
  const genCats = opts.skipGeneral ? ["01", "03"] : ["01", "03", "04", "05"];
  for (const cat of genCats) {
    try {
      let startRow = 0;
      const fetchSize = 100;
      while (true) {
        const gen = await fetchEventList(cat, startRow, fetchSize);
        generalEvents.push(...gen.list);
        if (startRow + fetchSize >= gen.totalCount || gen.list.length === 0) break;
        startRow += fetchSize;
      }
    } catch (err) {
      console.error(`  ⚠️ 일반 이벤트 목록(cat=${cat}) 실패: ${(err as Error).message}`);
    }
  }
  console.log(`  일반 이벤트 ${generalEvents.length}건 로드`);
  const detailImageCache = new Map<string, string[]>(); // evntNo → urls
  const matchedGeneralNos = new Set<string>(); // saprm 특전과 짝지어진 일반 이벤트 (피드 중복 방지)

  // 2. 이벤트별 굿즈 + 소진현황
  const result: CollectedEvent[] = [];
  let matchCount = 0;
  let titleFallbackCount = 0;
  let umbrellaCount = 0;
  let prodFailCount = 0; // searchSaprmEvtProdList 실패 건수 (2026-08 CGV app 레벨 403 폐기)
  const generalSiteCache = new Map<string, string[]>(); // evntNo → 진행 극장 siteNo[]
  for (const ev of limited) {
    // CGV가 2026-08-03 굿즈 상품목록 API(searchSaprmEvtProdList)를 app 레벨 403으로 폐기.
    // 이제 spmtlNo를 신규 발견할 수 없다. 세 갈래로 처리한다:
    //   ⓐ ProdList가 (혹시) 살아있으면 종전대로
    //   ⓑ DB에 spmtlNo가 있는 기존 이벤트 → tgtsiteList(생존)로 재고만 갱신
    //   ⓒ 그 외(신규 이벤트) → 이벤트명 = 굿즈명으로 합성, 재고 없이 이름/타입만
    let products: CgvSaprmProduct[] = [];
    try {
      products = await fetchSaprmProducts(ev.saprmEvntNo);
    } catch {
      prodFailCount++;
    }

    const stockFor = async (spmtlNo: string): Promise<CollectedStock[]> => {
      try {
        return (await fetchStockBySite(ev.saprmEvntNo, spmtlNo)).map(mapStock);
      } catch {
        prodFailCount++;
        return [];
      }
    };

    const goodies: CollectedGoodie[] = [];
    if (products.length > 0) {
      // ⓐ 레거시 경로
      for (const p of products) {
        goodies.push({
          name: (p.onlnExpoNm || p.spmtlProdNm || "").trim(),
          sourceGoodsId: p.spmtlNo,
          stock: await stockFor(p.spmtlNo),
        });
      }
    } else {
      const known = knownGoods.get(ev.saprmEvntNo);
      if (known && known.length > 0) {
        // ⓑ 기존 spmtlNo로 재고 유지
        for (const k of known) {
          goodies.push({
            name: k.name,
            sourceGoodsId: k.spmtlNo,
            stock: await stockFor(k.spmtlNo),
          });
        }
      } else {
        // ⓒ 신규 이벤트 — 이름/타입만 (재고 소스 없음)
        goodies.push({ name: ev.saprmEvntNm.trim(), stock: [] });
      }
    }

    // 일반 이벤트 매칭 → 상세 이미지 + 배너 이미지 (실패해도 특전 수집은 계속)
    // 3차(제목 폴백)에서 여러 후보가 나와도 가장 적합한 1건만 사용 — 주차 혼합 방지.
    let detailImageUrls: string[] | undefined;
    let imageUrl: string | undefined;
    const matches = matchGeneralEvents(ev.saprmEvntNm, generalEvents);
    if (matches.length > 0) {
      matchCount++;
      if (matches.length > 1) titleFallbackCount++;

      // 여러 후보 중 이름이 가장 유사한 것 선택 (정규화 후 공통 길이 기준)
      const target = normName(ev.saprmEvntNm);
      const best = matches.reduce((a, b) => {
        const na = normName(a.evntNm);
        const nb = normName(b.evntNm);
        const scoreA = commonPrefixLen(target, na);
        const scoreB = commonPrefixLen(target, nb);
        return scoreA >= scoreB ? a : b;
      });

      matchedGeneralNos.add(best.evntNo);

      // 배너 이미지
      if (best.lagBanrPhyscFilePathnm && best.lagBanrPhyscFnm) {
        imageUrl = buildContentImageUrl(best.lagBanrPhyscFilePathnm, best.lagBanrPhyscFnm);
      }

      // 상세 이미지 (1건만)
      try {
        if (!detailImageCache.has(best.evntNo)) {
          detailImageCache.set(best.evntNo, await fetchDetailImages(best.evntNo));
        }
        const urls = detailImageCache.get(best.evntNo)!;
        if (urls.length) detailImageUrls = urls;
      } catch (err) {
        console.error(
          `  ⚠️ 상세 이미지 실패 [${best.evntNo}] ${ev.saprmEvntNm}: ${(err as Error).message}`
        );
      }
    } else {
      // 5차(기획전 우산형): 한 이벤트가 여러 영화 특전을 묶는 기획전은 이름 매칭이 원천 불가.
      // 예: "[마녀배달부 키키]_A3포스터" ↔ "[월간신촌] 재패니메이션 컬렉션 VOL.02 (특전 공개_스튜디오 지브리)"
      // ①일반 이벤트명에 "특전" ②기간 겹침 ③진행 극장 집합 완전 일치(재고 극장 기준)가
      // 모두 맞을 때만 이미지를 차용한다 — "이미지 없음 > 그럴듯한 오이미지" 원칙 유지.
      const stockSites = [...new Set(goodies.flatMap((g) => g.stock.map((s) => s.branchCode)))].sort();
      const start = formatYmd(ev.evntStartYmd);
      const end = formatYmd(ev.evntEndYmd);
      if (stockSites.length > 0) {
        for (const e of generalEvents) {
          if (!e.evntNm.includes("특전")) continue;
          if (e.evntStartDt.slice(0, 10) > end || e.evntEndDt.slice(0, 10) < start) continue;
          try {
            if (!generalSiteCache.has(e.evntNo)) {
              generalSiteCache.set(e.evntNo, await fetchDetailSites(e.evntNo));
            }
            const sites = [...generalSiteCache.get(e.evntNo)!].sort();
            if (sites.length === 0 || sites.join(",") !== stockSites.join(",")) continue;

            matchCount++;
            umbrellaCount++;
            if (e.lagBanrPhyscFilePathnm && e.lagBanrPhyscFnm) {
              imageUrl = buildContentImageUrl(e.lagBanrPhyscFilePathnm, e.lagBanrPhyscFnm);
            }
            if (!detailImageCache.has(e.evntNo)) {
              detailImageCache.set(e.evntNo, await fetchDetailImages(e.evntNo));
            }
            const urls = detailImageCache.get(e.evntNo)!;
            if (urls.length) detailImageUrls = urls;
            // 우산 이벤트는 matchedGeneralNos에 넣지 않는다 — 기획전 자체도 피드에 남아야 하고,
            // 여러 saprm 특전(키키·모노노케)이 하나를 공유한다.
            break;
          } catch (err) {
            console.error(`  ⚠️ 우산 매칭 상세 실패 [${e.evntNo}]: ${(err as Error).message}`);
          }
        }
      }
    }

    result.push({
      chain: "CGV",
      sourceEventId: ev.saprmEvntNo,
      eventName: ev.saprmEvntNm,
      startDate: formatYmd(ev.evntStartYmd),
      endDate: formatYmd(ev.evntEndYmd),
      imageUrl,
      movieTitle: extractMovieTitle(ev.saprmEvntNm, products),
      detailImageUrls,
      category: "특전",
      goodies,
      raw: { event: ev, products },
    });
  }

  console.log(
    `  이미지 매칭: ${matchCount}/${limited.length} (제목 폴백: ${titleFallbackCount} · 기획전 우산: ${umbrellaCount})`
  );
  const withStock = result.filter((e) =>
    e.goodies.some((g) => g.stock.length > 0)
  ).length;
  if (prodFailCount > 0) {
    console.warn(
      `  ⚠️ CGV 상품목록 API(searchSaprmEvtProdList) 폐기(403) — spmtlNo 신규 발견 불가. ` +
        `기존 spmtlNo로 재고 유지 ${withStock}건 / 신규는 이름·타입만. (조회 실패 ${prodFailCount}회)`
    );
  }

  // 3. saprm과 매칭 안 된 일반 이벤트 → 자체 수집 (이벤트 피드용, 목록+배너만 가볍게)
  const CGV_CATEGORY: Record<string, string> = {
    "01": "영화",
    "03": "상영회",
    "04": "극장",
    "05": "제휴",
  };
  let generalAdded = 0;
  for (const e of generalEvents) {
    if (opts.skipGeneral) break; // 3h 크론: 일반 이벤트 수집 생략 (하루 2회 풀 크롤에서만)
    if (matchedGeneralNos.has(e.evntNo)) continue; // 특전으로 이미 표현됨
    if (opts.maxEvents && generalAdded >= opts.maxEvents) break;

    // 본문 이미지 (evntImfile) — 배너만으론 내용이 없어 상세를 붙인다 (건당 1콜)
    let detailImageUrls: string[] | undefined;
    try {
      if (!detailImageCache.has(e.evntNo)) {
        detailImageCache.set(e.evntNo, await fetchDetailImages(e.evntNo));
      }
      const urls = detailImageCache.get(e.evntNo)!;
      if (urls.length) detailImageUrls = urls;
    } catch {
      // 상세 실패 시 배너만
    }

    result.push({
      chain: "CGV",
      // saprm 번호와 형식이 같아 네임스페이스로 충돌 방지
      sourceEventId: `evt-${e.evntNo}`,
      eventName: e.evntNm,
      startDate: e.evntStartDt.slice(0, 10),
      endDate: e.evntEndDt.slice(0, 10),
      imageUrl:
        e.lagBanrPhyscFilePathnm && e.lagBanrPhyscFnm
          ? buildContentImageUrl(e.lagBanrPhyscFilePathnm, e.lagBanrPhyscFnm)
          : undefined,
      detailImageUrls,
      movieTitle: bracketTitle(e.evntNm) ?? undefined,
      linkMovieOnly: true, // 비영화 제목(오페라·중계 등)이 movies를 오염시키지 않게
      category: CGV_CATEGORY[e.evntCtgryLclsCd] ?? "기타",
      goodies: [],
      raw: { event: e },
    });
    generalAdded++;
  }
  console.log(`  일반 이벤트 수집: ${generalAdded}건 (특전 매칭 제외)`);

  return result;
}
