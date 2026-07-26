# 메가박스 크롤러

메가박스 이벤트 및 굿즈 소진현황 크롤러입니다.

## 실행 방법

```bash
# 의존성 설치 (최초 1회)
pnpm install

# 메가박스 크롤러 실행
pnpm --filter @cinemo/crawler megabox
```

## API 엔드포인트

### 이벤트 목록

- **URL**: `POST https://www.megabox.co.kr/on/oh/ohe/Event/eventMngDiv.do`
- **Content-Type**: `application/json`
- **Request Body**:
  ```json
  {
    "currentPage": "1",
    "recordCountPerPage": "100",
    "eventStatCd": "ONG",
    "eventDivCd": "CED01",
    "eventTyCd": "",
    "orderReqCd": "ONGlist"
  }
  ```
- **탭 구분 (eventDivCd)**:
  - `CED01`: 영화 탭 (특전/굿즈 이벤트)
  - `CED03`: 메가pick 탭

- **카테고리 (eventTyCd)**: (영화 탭 기준)
  - `ZEC`: 빵원쿠폰
  - `ZECP`: 빵원쿠폰플러스
  - `CET03`: 굿즈패키지
  - `POP`: 포인트플러스

- **응답**: HTML

### 이벤트 상세

- **URL**: `GET https://www.megabox.co.kr/event/detail?eventNo={이벤트번호}`
- **응답**: HTML
- **굿즈 정보 위치**: `<button data-pn="굿즈번호" data-nm="굿즈명">`

### 굿즈 소진현황

- **URL**: `POST https://www.megabox.co.kr/on/oh/ohe/Event/selectGoodsStockPrco.do`
- **Content-Type**: `application/json`
- **Request Body**:
  ```json
  {
    "eventNo": "20916",
    "goodsNo": "FG000894"
  }
  ```
- **응답**: HTML

## 응답 HTML 구조

### 이벤트 목록

```html
<input type="hidden" id="totCount" value="26" />
<ul>
  <li>
    <a href="#" data-no="20910" class="eventBtn">
      <p class="img"><img src="https://img.megabox.co.kr/..." /></p>
      <p class="tit">이벤트 제목</p>
      <p class="date">2026.07.18 ~ 2026.07.19</p>
    </a>
  </li>
</ul>
```

### 굿즈 소진현황

```html
<div class="layerGoodstheater">
  <div class="tit">굿즈명</div>
  <ul>
    <li class="area-cont" id="10">
      <button data-no="10" class="btn">서울 (2)</button>
      <div class="cont">
        <ul class="sect">
          <li brchCd="1581" class="brch">
            <a>목동</a>
            <span class="act">보유</span>
          </li>
        </ul>
      </div>
    </li>
  </ul>
</div>
```

### 소진 상태값

| 상태 | 의미 |
|------|------|
| 보유 | 재고 있음 |
| 소량보유 | 재고 적음 |
| 소진 | 품절 |
| 준비중 | 아직 준비 중 |

## CGV와의 차이점

| 항목 | CGV | 메가박스 |
|------|-----|----------|
| 응답 형식 | JSON | HTML |
| 인증 | HMAC-SHA256 서명 | 없음 |
| 재고 정보 | 정확한 수량 (92/100) | 상태값만 (보유/소량보유/소진) |
| 파싱 방식 | JSON.parse | cheerio (HTML 파싱) |
