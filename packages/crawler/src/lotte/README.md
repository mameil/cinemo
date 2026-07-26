# 롯데시네마 크롤러

## 개요

롯데시네마 LCWS API를 호출하여 극장 목록, 상영일, 이벤트(굿즈/시사회/무대인사) 정보를 수집한다.

## 실행 방법

```bash
pnpm --filter @cinemo/crawler lotte
```

## API 인증

롯데시네마 API는 별도 인증이 필요 없다. 단, **Event API는 `multipart/form-data`** 형식으로 전송해야 한다.

- 일반 API (극장, 상영일): `application/x-www-form-urlencoded`
- 이벤트 API: `multipart/form-data`

파라미터는 `paramList` 필드에 JSON 문자열로 전달한다.

```typescript
// multipart/form-data 형식
const boundary = "----WebKitFormBoundary" + Math.random().toString(36).slice(2);
const body = [
  `--${boundary}`,
  'Content-Disposition: form-data; name="paramList"',
  "",
  JSON.stringify({ MethodName: "GetEventLists", ... }),
  `--${boundary}--`,
].join("\r\n");
```

## API 엔드포인트

| 함수 | API | MethodName | 용도 |
|---|---|---|---|
| `fetchCinemaList()` | `/Cinema/CinemaData.aspx` | GetCinemaItems | 극장 목록 |
| `fetchPlayDates()` | `/Ticketing/TicketingData.aspx` | GetMoviePlayDates | 상영일 목록 |
| `fetchEventList()` | `/Event/EventData.aspx` | GetEventLists | 이벤트 목록 (카테고리별) |
| `fetchGoodsEvents()` | `/Event/EventData.aspx` | GetEventLists (code=20) | 굿즈 이벤트 목록 |
| `fetchStageGreetingEvents()` | `/Event/EventData.aspx` | GetEventLists (code=40) | 시사회/무대인사 목록 |
| `fetchEventDetail()` | `/Event/EventData.aspx` | GetInfomationDeliveryEventDetail | 이벤트 상세 |

Base URL: `https://www.lottecinema.co.kr/LCWS`

## 이벤트 분류 코드

| 코드 | 분류명 |
|------|--------|
| 10 | 리미티드 (HOT) |
| 20 | 굿즈 (영화 특전) |
| 30 | 우리동네영화관 |
| 40 | 시사회/무대인사 |
| 50 | 제휴할인 |

## 데이터 흐름

```
fetchCinemaList → 전국 극장 목록 (지역별)

fetchPlayDates → 상영 가능일 (약 6주)

fetchEventList (카테고리=20 굿즈)
  └─ fetchEventDetail (EventTypeCode 필요)
       └─ 이벤트 내용, 유의사항, 연결 영화

fetchEventList (카테고리=40 시사회/무대인사)
  └─ 무대인사/GV 일정
```

## 주요 응답 필드

### 극장 목록 (`fetchCinemaList`)
```json
{
  "CinemaID": 1013,
  "CinemaName": "가산디지털",
  "CinemaNameKR": "가산디지털",
  "DivisionCode": 1,                // 지역 코드 (1=서울)
  "CinemaAddrSummary": "디지털로10길 9 (현대아울렛 가산)",
  "StageGreetingYN": "Y",           // 무대인사 가능 여부
  "Latitude": "37.4776",
  "Longitude": "126.8858"
}
```

### 상영일 (`fetchPlayDates`)
```json
{
  "PlayDate": "2026-07-10",
  "Year": 2026,
  "Month": 7,
  "Day": 10,
  "DayOfWeekKR": "금",
  "DayOfWeekEN": "Fri",
  "HolidayYN": "N"
}
```

### 이벤트 목록 (`fetchEventList`)
```json
{
  "EventID": "201110014726023",
  "EventName": "<호프> 얼리버드 이벤트",
  "EventClassificationCode": "20",        // 분류 코드 (20=굿즈)
  "EventTypeCode": "111",                 // 이벤트 타입 (상세 조회 시 필요)
  "EventTypeName": "버튼형",
  "ProgressStartDate": "2026.07.07",
  "ProgressEndDate": "2026.07.14",
  "RemainsDayCount": 4,                   // D-day
  "ImageUrl": "http://cf.lottecinema.co.kr//Media/Event/xxx.jpg",
  "CinemaID": "",                         // 특정 지점 한정 시
  "CinemaName": "",
  "EventNtc": "ㆍ 실물 티켓 및 바로티켓..."  // 유의사항 (목록에서도 제공)
}
```
- 이미지 URL: 응답에 전체 URL 포함 (CDN: `cf.lottecinema.co.kr`)

### 이벤트 상세 (`fetchEventDetail`)
```json
{
  "EventID": "201110014726023",
  "EventName": "<호프> 얼리버드 이벤트",
  "EventCntnt": "<HTML 형식 이벤트 내용>",
  "EventNtc": "<HTML 형식 유의사항>",
  "ProgressStartDate": "2026-07-07",
  "ProgressEndDate": "2026-07-14",
  "ImageUrl": "/Media/Event/xxx.jpg",
  "MovieName": "호프",           // 연결 영화 (있는 경우)
  "MovieCode": "12345"
}
```

## 주의사항

1. **Event API Content-Type**: 반드시 `multipart/form-data`로 전송해야 함. `application/x-www-form-urlencoded`는 "개체 참조" 에러 발생.

2. **이벤트 상세 조회 시 EventTypeCode 필수**: `fetchEventDetail(eventId, eventTypeCode)` - 이벤트 목록에서 받은 `EventTypeCode`를 함께 전달해야 함.

3. **MethodName 주의**: 상세 조회는 `GetEventDetail`이 아니라 `GetInfomationDeliveryEventDetail` 사용.

4. **지점별 소진 현황 API 미확인**: CGV와 달리 롯데시네마는 지점별 굿즈 소진 현황 API가 별도로 확인되지 않음. 추후 조사 필요.
