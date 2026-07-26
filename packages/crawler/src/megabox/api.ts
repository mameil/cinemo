/**
 * 메가박스 API 클라이언트
 *
 * 엔드포인트 정리:
 * - 이벤트 목록: www.megabox.co.kr/on/oh/ohe/Event/eventMngDiv.do (POST, HTML 응답)
 * - 이벤트 상세: www.megabox.co.kr/event/detail?eventNo={번호} (GET, HTML 응답)
 * - 굿즈 소진현황: www.megabox.co.kr/on/oh/ohe/Event/selectGoodsStockPrco.do (POST, HTML 응답)
 */

import { execSync } from "child_process";
import * as cheerio from "cheerio";

const BASE_URL = "https://www.megabox.co.kr";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

// ── 타입 ────────────────────────────────────────

export interface MegaboxEventItem {
  eventNo: string;
  eventTitle: string;
  imageUrl: string;
  startDate: string; // YYYY.MM.DD
  endDate: string; // YYYY.MM.DD
}

export interface MegaboxGoodsInfo {
  goodsNo: string;
  goodsName: string;
}

export interface MegaboxStockItem {
  regionCode: string;
  regionName: string;
  branchCode: string;
  branchName: string;
  status: "보유" | "소량보유" | "소진" | "준비중";
}

// ── HTTP 호출 ────────────────────────────────────

/** 동기 sleep (재시도 백오프용) */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function fetchHtml(
  url: string,
  method: "GET" | "POST" = "GET",
  body?: object
): string {
  // curl 자체 재시도(--retry) + 넉넉한 타임아웃
  let cmd = `curl -s --max-time 25 --retry 3 --retry-delay 2 '${url}' -H 'User-Agent: ${USER_AGENT}'`;
  if (method === "POST" && body) {
    cmd += ` -H 'Content-Type: application/json' -d '${JSON.stringify(body)}'`;
  }

  // JS 레벨 재시도: 일시적 실패/빈 응답에 견디도록 (CI 대량요청 대비)
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = execSync(cmd, {
        encoding: "utf-8",
        timeout: 30000,
        maxBuffer: 32 * 1024 * 1024,
      });
      if (result && result.trim()) return result;
      lastErr = new Error("빈 응답");
    } catch (e) {
      lastErr = e;
    }
    if (attempt < 3) sleepSync(1000 * attempt); // 1s, 2s 백오프
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ── API 함수 ────────────────────────────────────

/**
 * 이벤트 목록 (영화 탭)
 * @param page 페이지 번호 (1부터 시작)
 * @param count 한 페이지당 개수
 * @param eventDivCd 탭 코드 (CED01=영화, CED03=메가pick)
 */
export async function fetchEventList(
  page: number = 1,
  count: number = 100,
  eventDivCd: string = "CED01"
): Promise<{ totalCount: number; list: MegaboxEventItem[] }> {
  const url = `${BASE_URL}/on/oh/ohe/Event/eventMngDiv.do`;
  const body = {
    currentPage: String(page),
    recordCountPerPage: String(count),
    eventStatCd: "ONG", // 진행중
    eventDivCd,
    eventTyCd: "",
    orderReqCd: "ONGlist",
  };

  const html = fetchHtml(url, "POST", body);
  const $ = cheerio.load(html);

  // 총 개수
  const totalCount = parseInt($("#totCount").val() as string) || 0;

  // 이벤트 목록 파싱
  const list: MegaboxEventItem[] = [];

  $("li > a.eventBtn").each((_, el) => {
    const $el = $(el);
    const eventNo = $el.attr("data-no") || "";
    const eventTitle = $el.find("p.tit").text().trim();
    const imageUrl = $el.find("p.img img").attr("src") || "";
    const dateText = $el.find("p.date").text().trim(); // "2026.07.18 ~ 2026.07.19"

    // 날짜 파싱
    const [startDate, endDate] = dateText.split("~").map((d) => d.trim());

    if (eventNo) {
      list.push({
        eventNo,
        eventTitle,
        imageUrl,
        startDate: startDate || "",
        endDate: endDate || startDate || "",
      });
    }
  });

  return { totalCount, list };
}

/**
 * 이벤트 상세에서 굿즈 정보 + 본문 이미지(굿즈 실물 도안) 추출.
 * 본문 에디터 이미지(`\SharedImg\editorImg\...`)가 OT 앞/뒷면 등 실제 특전 그림이다.
 */
export async function fetchEventGoods(
  eventNo: string
): Promise<{ goods: MegaboxGoodsInfo[]; detailImageUrls: string[] }> {
  const url = `${BASE_URL}/event/detail?eventNo=${eventNo}`;
  const html = fetchHtml(url, "GET");
  const $ = cheerio.load(html);

  const goods: MegaboxGoodsInfo[] = [];

  // 굿즈 소진현황 버튼에서 굿즈 정보 추출
  // <button data-pn="FG000894" data-nm="&lt;마티 슈프림&gt; 2주차 주말 포스터">
  $("button[data-pn]").each((_, el) => {
    const $el = $(el);
    const goodsNo = $el.attr("data-pn") || "";
    const goodsName = $el.attr("data-nm") || "";

    if (goodsNo) {
      goods.push({
        goodsNo,
        goodsName: decodeHtmlEntities(goodsName),
      });
    }
  });

  // 본문 에디터 이미지 (경로가 백슬래시 상대경로로 옴 → img 호스트 절대 URL로 정규화)
  // 보일러플레이트 제외 규칙:
  //  - usemap 있는 이미지 = 클릭 버튼 스트립(영화정보/예매하기)
  //  - style height가 낮은 이미지 = 버튼/구분선
  const MIN_CONTENT_IMG_HEIGHT = 400;
  const detailImageUrls: string[] = [];
  $('img[src*="editorImg"]').each((_, el) => {
    const src = $(el).attr("src") || "";
    if (!src) return;
    if ($(el).attr("usemap")) return;
    const style = $(el).attr("style") || "";
    const heightMatch = style.match(/height:\s*(\d+)px/);
    if (heightMatch && parseInt(heightMatch[1]) < MIN_CONTENT_IMG_HEIGHT) return;
    const normalized = src.replace(/\\/g, "/");
    const abs = normalized.startsWith("http")
      ? normalized
      : `https://img.megabox.co.kr${normalized.startsWith("/") ? "" : "/"}${normalized}`;
    if (!detailImageUrls.includes(abs)) detailImageUrls.push(abs);
  });

  return { goods, detailImageUrls };
}

/**
 * 굿즈 소진현황 조회
 */
export async function fetchGoodsStock(
  eventNo: string,
  goodsNo: string
): Promise<{ goodsName: string; stock: MegaboxStockItem[] }> {
  const url = `${BASE_URL}/on/oh/ohe/Event/selectGoodsStockPrco.do`;
  const body = { eventNo, goodsNo };

  const html = fetchHtml(url, "POST", body);
  const $ = cheerio.load(html);

  const goodsName = $(".layerGoodstheater .tit").text().trim();
  const stock: MegaboxStockItem[] = [];

  // 지역별 파싱
  $("li.area-cont").each((_, areaEl) => {
    const $area = $(areaEl);
    const regionCode = $area.attr("id") || "";
    // 지역명: "서울 (2)" -> "서울"
    const regionText = $area.find("button.btn").text().trim();
    const regionName = regionText.replace(/\s*\(\d+\)$/, "");

    // 지점별 파싱
    $area.find("li.brch").each((_, brchEl) => {
      const $brch = $(brchEl);
      const branchCode = $brch.attr("brchcd") || "";
      const branchName = $brch.find("a").text().trim();
      const statusText = $brch.find("span").text().trim();

      let status: MegaboxStockItem["status"];
      if (statusText === "보유") {
        status = "보유";
      } else if (statusText === "소량보유") {
        status = "소량보유";
      } else if (statusText === "소진") {
        status = "소진";
      } else {
        status = "준비중";
      }

      stock.push({
        regionCode,
        regionName,
        branchCode,
        branchName,
        status,
      });
    });
  });

  return { goodsName, stock };
}

// ── 상영시간표 API ────────────────────────────────

/** 수도권 지점 (selectPlayTimeMasterList) */
export interface MegaBranch {
  areaCd: string; // 10=서울 30=경기 35=인천 ...
  areaCdNm: string;
  brchNo: string;
  brchNm: string;
}

/** 상영 회차 (schedulePage → megaMap.movieFormList) */
export interface MegaScheduleItem {
  brchNo: string;
  brchNm: string;
  rpstMovieNm: string; // 대표 영화명
  movieNm: string; // 버전 영화명 ("(더빙) ..." 접두 가능)
  rpstMovieNo: string;
  movieNo: string;
  playDe: string; // YYYYMMDD
  playStartTime: string; // HH:MM
  playEndTime: string;
  theabExpoNm: string; // 상영관 이름
  theabKindCd: string; // 상영관 종류 (NOR/RCL/MX/IMX ...)
  playKindNm: string; // "2D(자막)" 등
  restSeatCnt: number;
  totSeatCnt: number;
}

/** 수도권(서울10/경기30/인천35) 지점 목록 */
export async function fetchMetroBranches(playDe: string): Promise<MegaBranch[]> {
  const html = fetchHtml(
    `${BASE_URL}/on/oh/ohb/PlayTime/selectPlayTimeMasterList.do`,
    "POST",
    { playDe }
  );
  const json = JSON.parse(html) as { areaBrchList?: MegaBranch[] };
  const metro = new Set(["10", "30", "35"]);
  return (json.areaBrchList ?? [])
    .filter((b) => metro.has(b.areaCd))
    .map((b) => ({ ...b, brchNm: decodeHtmlEntities(b.brchNm ?? "") }));
}

/** 특정 지점·날짜 상영 회차 */
export async function fetchSchedule(
  brchNo: string,
  playDe: string
): Promise<MegaScheduleItem[]> {
  // 주의: 지점 필터 키는 brchNo1 (brchNo만 주면 전국 기본목록이 반환됨)
  const html = fetchHtml(`${BASE_URL}/on/oh/ohc/Brch/schedulePage.do`, "POST", {
    masterType: "brch",
    brchNo1: brchNo,
    playDe,
  });
  const json = JSON.parse(html) as {
    megaMap?: { movieFormList?: MegaScheduleItem[] };
  };
  return json.megaMap?.movieFormList ?? [];
}

// ── 유틸 함수 ────────────────────────────────────

export function decodeHtmlEntities(text: string): string {
  // 원본 속성이 이중 인코딩(&amp;lt;)인 경우가 있어 완전히 풀릴 때까지 반복.
  // 주의: &amp; 를 먼저 풀어야 &amp;lt; → &lt; → < 순서로 진행된다 (예전엔 &lt;가 먼저라 &lt;에서 멈춤)
  let prev = text;
  for (let i = 0; i < 3; i++) {
    const next = prev
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#40;/g, "(")
      .replace(/&#41;/g, ")");
    if (next === prev) break;
    prev = next;
  }
  return prev;
}

/**
 * 메가박스 날짜 형식을 ISO 형식으로 변환
 * "2026.07.18" -> "2026-07-18"
 */
export function formatDate(megaboxDate: string): string {
  return megaboxDate.replace(/\./g, "-");
}
