# CGV 크롤러

## 개요

CGV 이벤트 페이지의 JSON API를 호출하여 특전/굿즈 이벤트 정보와 지점별 소진 현황을 수집한다.

## 실행 방법

```bash
pnpm --filter @cinemo/crawler cgv
```

## API 인증

CGV API는 **HMAC-SHA256 서명** 기반 인증을 사용한다.

- 알고리즘: HMAC-SHA256 → Base64
- 비밀키: 하드코딩 (CGV 프론트엔드 JS 번들에서 추출)
- 서명 대상: `{Unix타임스탬프(초)}|{URL pathname}|{request body}`
- 헤더: `x-timestamp`, `x-signature`

추가로 Cloudflare가 TLS fingerprint(JA3)를 차단한다. 일반 `curl`도 403으로 막히므로,
Chrome을 흉내내는 **`curl-impersonate`** 바이너리를 child process로 실행해 우회한다.

### curl-impersonate 설치 (필수)

```bash
# lexiforest/curl-impersonate 릴리스에서 플랫폼 바이너리 다운로드 후 설치
mkdir -p ~/.local/bin
# 예) macOS arm64
curl -sL https://github.com/lexiforest/curl-impersonate/releases/latest/download/curl-impersonate-v1.5.6.arm64-macos.tar.gz \
  | tar -xz -C /tmp && cp /tmp/curl-impersonate ~/.local/bin/ && chmod +x ~/.local/bin/curl-impersonate
```

- 기본 경로: `~/.local/bin/curl-impersonate`
- 다른 경로면 `.env`의 `CURL_IMPERSONATE_BIN`으로 지정
- Chrome 131 TLS 파라미터(`--ciphers`, `--curves`)를 함께 전달해야 통과됨 (`api.ts` 참고)

## API 엔드포인트

| 함수 | API | 용도 |
|---|---|---|
| `fetchEventList()` | `searchEvtListForPage` | 이벤트 목록 (카테고리별, 페이징) |
| `fetchEventDetail()` | `searchEvtDtl` | 이벤트 상세 (연결 영화, 이미지) |
| `fetchSaprmEventList()` | `searchSaprmEvtListForPage` | 특전(증정품) 이벤트 목록 |
| `fetchSaprmProducts()` | `searchSaprmEvtProdList` | 특전 이벤트의 굿즈 종류 |
| `fetchStockBySite()` | `searchSaprmEvtTgtsiteList` | 지점별 소진 현황 |

## 데이터 흐름

```
fetchEventList (카테고리=03 영화)
  └─ fetchEventDetail (이벤트 상세)
       └─ ctgmovLst → 연결된 영화 정보

fetchSaprmEventList (특전 이벤트 목록)
  └─ fetchSaprmProducts (굿즈 종류)
       └─ fetchStockBySite (지점별 재고)
```

## 주요 응답 필드

### 이벤트 목록 (`fetchEventList`)
```json
{
  "evntNo": "202607038535",         // 이벤트 번호 (PK)
  "evntNm": "[해피엔드] 3주차 현장이벤트",  // 이벤트명
  "evntStartDt": "2026-07-08 00:00:00",  // 시작일
  "evntEndDt": "2026-07-14 23:59:59",    // 종료일
  "evntCtgryLclsCd": "03",                // 대분류 (03=영화)
  "lagBanrPhyscFilePathnm": "cgvpomscontent/ips/evnt/2026/0703",  // 이미지 경로
  "lagBanrPhyscFnm": "8c42d36add7f48d381c29a60b6309aee.jpg"      // 이미지 파일명
}
```
- 이미지 URL = `https://cdn.cgv.co.kr/{경로}/{파일명}`
- 카테고리: `01`=SPECIAL, `03`=영화, `04`=극장, `05`=제휴

### 이벤트 상세 (`fetchEventDetail`)
```json
{
  "ctgmovLst": [{ "movNm": "해피엔드", "movNo": "89520" }]  // 연결 영화
}
```

### 특전 이벤트 (`fetchSaprmEventList`)
```json
{
  "saprmEvntNo": "202607030109",  // 특전 이벤트 번호
  "saprmEvntNm": "[너바나 더 밴드...] 개봉 8주차 현장 이벤트",
  "evntStartYmd": "20260708",     // 시작일 (YYYYMMDD)
  "evntEndYmd": "20260714"        // 종료일
}
```

### 굿즈 목록 (`fetchSaprmProducts`)
```json
{
  "spmtlNo": "2026070301099114",        // 상품 번호
  "spmtlProdNm": "[너바나] 맷&제이 포스터(A3)",  // 굿즈명
  "onlnExpoNm": "[너바나] 맷&제이 포스터(A3)"    // 노출명
}
```

### 지점별 소진 현황 (`fetchStockBySite`)
```json
{
  "siteNo": "0056",       // 지점 코드
  "siteNm": "CGV 강남",    // 지점명
  "expoSiteNm": "강남",    // 노출 지점명
  "regnGrpNm": "서울",     // 지역
  "rlInvntQty": 92,       // 잔여 수량
  "totPayQty": 100,       // 총 수량
  "fcfsPayYn": "N"        // 선착순 여부
}
```
- 소진 판단: `rlInvntQty === 0` → 소진
