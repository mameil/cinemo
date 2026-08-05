/**
 * CGV API 클라이언트
 *
 * 엔드포인트 정리:
 * - 이벤트 목록: event.cgv.co.kr/evt/evt/evt/searchEvtListForPage
 * - 이벤트 상세: event.cgv.co.kr/evt/evt/evtDtl/searchEvtDtl
 * - 특전 목록: event.cgv.co.kr/evt/saprm/saprm/searchSaprmEvtListForPage
 * - 특전 상품: event.cgv.co.kr/evt/saprm/saprm/searchSaprmEvtProdList
 * - 소진 현황: event.cgv.co.kr/evt/saprm/saprm/searchSaprmEvtTgtsiteList
 */

import { createHmac } from "crypto";
import { execSync } from "child_process";
import { homedir } from "os";

const EVENT_BASE = "https://event.cgv.co.kr/evt";
const CO_CD = "A420";
const HMAC_KEY = "ydqXY0ocnFLmJGHr_zNzFcpjwAsXq_8JcBNURAkRscg";

// Cloudflare가 일반 curl의 TLS 지문(JA3)을 403으로 차단하므로,
// Chrome을 흉내내는 curl-impersonate 바이너리를 사용한다.
// 설치: GitHub lexiforest/curl-impersonate 릴리스 → ~/.local/bin/curl-impersonate
const CURL_BIN =
  process.env.CURL_IMPERSONATE_BIN || `${homedir()}/.local/bin/curl-impersonate`;

// Chrome 131 TLS 지문 파라미터 (curl-impersonate의 curl_chrome131 래퍼에서 추출)
const CHROME_CIPHERS =
  "TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA";
const CHROME_CURVES = "X25519MLKEM768:X25519:P-256:P-384";

// ── 타입 ────────────────────────────────────────

export interface CgvEventItem {
  coCd: string;
  evntNo: string;
  evntNm: string;
  evntStartDt: string;
  evntEndDt: string;
  evntCtgryLclsCd: string;
  evntCtgryMclsCd: string | null;
  lagBanrPhyscFilePathnm: string;
  lagBanrPhyscFnm: string;
  evntLnkUrl: string | null;
}

export interface CgvEventDetail {
  evntNo: string;
  evntNm: string;
  evntStartDt: string;
  evntEndDt: string;
  evntCtgryLclsCd: string;
  evntCtgryMclsCd: string | null;
  evntImfilePhyscFilePathnm: string;
  evntImfilePhyscFnm: string;
  ctgmovLst: { movNm: string; movNo: string }[];
}

export interface CgvSaprmEvent {
  saprmEvntNo: string;
  saprmEvntNm: string;
  evntOnlnExpoNm: string;
  evntStartYmd: string;
  evntEndYmd: string;
  exhsYn: string;
}

export interface CgvSaprmProduct {
  spmtlNo: string;
  spmtlProdNo: string;
  spmtlProdNm: string;
  onlnExpoNm: string;
}

export interface CgvStockItem {
  spmtlNo: string;
  siteNo: string;
  siteNm: string;
  expoSiteNm: string;
  regnGrpCd: string;
  regnGrpNm: string;
  fcfsPayYn: string;
  sortOseq?: number;
  // 2026-08 신규 응답: 숫자 재고(rlInvntQty/totPayQty)가 사라지고 상태 색상만 제공.
  //   "green" = 보유 · "gray" = 소진/미취급
  inventStatus: string;
}

// ── 서명 생성 ───────────────────────────────────

function generateSignature(pathname: string, body: string = ""): {
  "x-timestamp": string;
  "x-signature": string;
} {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${timestamp}|${pathname}|${body}`;
  const signature = createHmac("sha256", HMAC_KEY)
    .update(message)
    .digest("base64");
  return { "x-timestamp": timestamp, "x-signature": signature };
}

// ── API 호출 ────────────────────────────────────

/** 동기 sleep (재시도 백오프용) */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

async function fetchJson<T>(url: string): Promise<T> {
  const { pathname } = new URL(url);

  // 일시적 실패(네트워크/타임아웃/Cloudflare 순간차단)에 대비한 재시도
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const sig = generateSignature(pathname); // 매 시도마다 타임스탬프 갱신
    try {
      // Cloudflare 우회: curl-impersonate + Chrome 131 TLS 지문 (--retry로 curl 레벨 재시도)
      const result = execSync(
        `'${CURL_BIN}' -s --max-time 25 --retry 2 --retry-delay 2 '${url}' ` +
          `--ciphers ${CHROME_CIPHERS} ` +
          `--curves ${CHROME_CURVES} ` +
          `-H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' ` +
          `-H 'sec-ch-ua: "Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"' ` +
          `-H 'sec-ch-ua-mobile: ?0' ` +
          `-H 'sec-ch-ua-platform: "macOS"' ` +
          `-H 'Origin: https://cgv.co.kr' ` +
          `-H 'Referer: https://cgv.co.kr/' ` +
          `-H 'Accept: application/json, text/plain, */*' ` +
          `-H 'x-timestamp: ${sig["x-timestamp"]}' ` +
          `-H 'x-signature: ${sig["x-signature"]}'`,
        { encoding: "utf-8", timeout: 30000, maxBuffer: 32 * 1024 * 1024 }
      );
      const json = JSON.parse(result);
      if (json.statusCode !== 0) {
        throw new Error(
          `CGV API statusCode: ${json.statusCode} - ${json.statusMessage}`
        );
      }
      return json.data;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) sleepSync(1000 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 이벤트 목록 (카테고리별, 페이징) */
export async function fetchEventList(
  categoryCode: string = "03",
  startRow: number = 0,
  listCount: number = 50
): Promise<{ totalCount: number; list: CgvEventItem[] }> {
  const url = `${EVENT_BASE}/evt/evt/searchEvtListForPage?coCd=${CO_CD}&evntCtgryLclsCd=${categoryCode}&sscnsChoiYn=N&expnYn=N&expoChnlCd=01&startRow=${startRow}&listCount=${listCount}`;
  return fetchJson(url);
}

/** 이벤트 상세 */
export async function fetchEventDetail(
  evntNo: string
): Promise<CgvEventDetail> {
  const url = `${EVENT_BASE}/evt/evtDtl/searchEvtDtl?coCd=${CO_CD}&evntNo=${evntNo}&expoChnlCd=01&previewYn=N&expnYn=N`;
  return fetchJson(url);
}

/** 특전(증정품) 이벤트 목록 */
export async function fetchSaprmEventList(
  startRow: number = 0,
  listCount: number = 50
): Promise<{ totalCount: number; list: CgvSaprmEvent[] }> {
  const url = `${EVENT_BASE}/saprm/saprm/searchSaprmEvtListForPage?coCd=${CO_CD}&startRow=${startRow}&listCount=${listCount}`;
  return fetchJson(url);
}

/** 특전 이벤트의 상품(굿즈) 목록 */
export async function fetchSaprmProducts(
  saprmEvntNo: string
): Promise<CgvSaprmProduct[]> {
  const url = `${EVENT_BASE}/saprm/saprm/searchSaprmEvtProdList?coCd=${CO_CD}&saprmEvntNo=${saprmEvntNo}`;
  return fetchJson(url);
}

/** 지점별 소진 현황 */
export async function fetchStockBySite(
  saprmEvntNo: string,
  spmtlNo: string
): Promise<CgvStockItem[]> {
  const url = `${EVENT_BASE}/saprm/saprm/searchSaprmEvtTgtsiteList?coCd=${CO_CD}&saprmEvntNo=${saprmEvntNo}&spmtlNo=${spmtlNo}`;
  return fetchJson(url);
}

/** CGV 이미지 URL 조합 */
export function buildImageUrl(path: string, filename: string): string {
  return `https://cdn.cgv.co.kr/${path}/${filename}`;
}

// ── 상영시간표 API (api.cgv.co.kr) ────────────────

const API_BASE = "https://api.cgv.co.kr";

/** 극장 (지역+극장 목록) */
export interface CgvSite {
  regnGrpCd: string; // 01=서울 02=경기 03=인천 ...
  siteNo: string; // 4자리 극장코드
  siteNm: string;
}

/** 상영 회차 (searchMovScnInfo) */
export interface CgvScnItem {
  siteNo: string;
  siteNm: string;
  scnsNm: string; // 상영관명 ("1관 (Laser)")
  scnYmd: string; // YYYYMMDD
  scnsrtTm: string; // HHMM
  scnendTm: string; // HHMM
  movNo: string;
  movNm: string;
  movkndDsplNm: string; // 포맷 (2D / 4DX 2D / IMAX ...)
  sbtdivNm: string | null; // 자막 / 더빙
  frSeatCnt: string; // 잔여좌석
  stcnt: string; // 총좌석
}

const CGV_REGION_NM: Record<string, string> = {
  "01": "서울",
  "02": "경기",
  "03": "인천",
};

/** regnGrpCd → 지역명 */
export function cgvRegionName(regnGrpCd: string): string | undefined {
  return CGV_REGION_NM[regnGrpCd];
}

/** 수도권(서울01/경기02/인천03) 극장 목록 */
export async function fetchMetroSites(): Promise<CgvSite[]> {
  const data = await fetchJson<{ siteInfo: CgvSite[] }>(
    `${API_BASE}/cnm/site/searchAllRegionAndSite?coCd=${CO_CD}`
  );
  const metro = new Set(["01", "02", "03"]);
  return (data.siteInfo ?? []).filter((s) => metro.has(s.regnGrpCd));
}

/** 특정 극장·날짜 상영 회차 */
export async function fetchScreenSchedule(
  siteNo: string,
  scnYmd: string
): Promise<CgvScnItem[]> {
  const url = `${API_BASE}/cnm/atkt/searchMovScnInfo?coCd=${CO_CD}&siteNo=${siteNo}&scnYmd=${scnYmd}&rtctlScopCd=1`;
  return fetchJson<CgvScnItem[]>(url);
}
