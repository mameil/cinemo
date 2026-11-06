# 로컬 감시 (예매 오픈 · 이벤트 · 좌석) — ntfy 폰 푸시

개인 PC에서 주기적으로 CGV·메가박스를 조회해, 알릴 일이 생기면 **ntfy 폰 푸시**로만 알린다.
맥(launchd)·윈도우(작업 스케줄러) 공통 코드 — 2026-11-06 sh 래퍼에서 Node 실행기로 이관.
**주 실행 PC는 윈도우**(Orca relay로 원격 관리 가능 · 상시 켜짐). 맥은 보조.

| 종류 | 감지 | 판정 로직 |
|---|---|---|
| `open` | CGV 극장×날짜(범위)×영화(×포맷) 예매 오픈 | `cgv/watch-open.ts` `checkOpen()` |
| `event` | CGV·메가박스 진행중 이벤트에 키워드 이벤트 새로 등장 | `watch-event.ts` `checkEvents()` |
| `seat` | CGV 특정 회차 지정 좌석이 새로 빈자리 | `watch/run.ts` (`fetchSeatMap`) |

## 사용법

```bash
pnpm --filter @cinemo/crawler watch-agent -- list
pnpm --filter @cinemo/crawler watch-agent -- add dune-imax open 120 site=0059 date=2026-12-15..2026-12-20 movie=듄 format=IMAX
pnpm --filter @cinemo/crawler watch-agent -- add lookback event 300 'match=룩백|look ?back' chains=megabox label=룩백 expire=20261201
pnpm --filter @cinemo/crawler watch-agent -- add hateful8 seat 60 site=0054 ymd=20261105 scns=001 sseq=4 'targets=C6 C7' end=202611051715
pnpm --filter @cinemo/crawler watch-agent -- run dune-imax     # 스케줄러 없이 1회
pnpm --filter @cinemo/crawler watch-agent -- remove dune-imax
```

- 공통 키: `label`(알림 제목) · `expire`(YYYYMMDD 이후 통과). 키 전체는 `src/watch/config.ts`.
- `open`의 `date=A..B` 범위나 `format`을 주면 ⓐ(회차 등장)만 알린다. 단일 날짜·포맷 없음이면
  ⓑ(날짜는 열렸는데 영화 없음 = 특별전 종료)도 알린다. 대형 극장 범위 감시에서 ⓑ는 매번 오탐.
- 포맷은 **상영 포맷(`movkndDsplNm`)** 으로 판별한다. 관 이름은 안 된다 — IMAX관에서 일반 2D를
  틀기도 한다(영등포 "최종면접(non-IMAX)", 2026-11 실측).
- 재등록하면 상태(알림 횟수·본 이벤트)가 초기화된다. **다른 PC로 옮길 땐** 원래 PC의
  `~/.cinemo/watch/state/<이름>/seen.txt`를 새 PC 같은 경로에 먼저 넣고 `--keep-state`로 add —
  안 그러면 이미 알린 이벤트가 전부 "새것"으로 다시 울린다.

## 파일 위치 (전부 레포 밖 — public 레포라 커밋 금지)

| 경로 | 내용 |
|---|---|
| `~/.cinemo/watch/<이름>.json` | 감시 설정 (대상 극장·좌석·키워드) |
| `~/.cinemo/watch/state/<이름>/` | 알림 횟수 · 연속 실패 · 본 이벤트(seen.txt) · 직전 빈 좌석 |
| `~/.cinemo/ntfy-topic` | 폰 푸시 토픽 (추측 불가 랜덤 — 아는 사람은 누구나 구독 가능) |
| `~/.cinemo/ntfy-topic-<종류>` | 종류별 토픽 (있으면 우선) |
| `~/.cinemo/ca-bundle.pem` | 회사망 SSL 가로채기 CA (있으면 curl·ntfy에 적용) |
| 로그 | 맥 `~/Library/Logs/cinemo-watch.log` · 윈도우 `%LOCALAPPDATA%\cinemo-watch.log` |

## 알림 규칙

- 우선순위 5(방해금지 관통) = 감지 · 4 = ⓑ · 3 = 감시 장애 · 2 = 복구.
- 예매 오픈은 같은 건 최대 5회(놓쳤을 때 복구용), 이벤트는 새 이벤트마다 1회, 좌석은 "새로 빈" 자리만.
- 연속 실패가 open/seat 5회 · event 6회 이어질 때만 장애 1회, 복구되면 복구 1회.
  결과를 못 낸 실행은 전부 실패로 센다 — 죽은 감시를 "대기"로 오인하는 게 가장 나쁜 실패.

## 스케줄러

- **맥**: `~/Library/LaunchAgents/com.cinemo.watch.<이름>.plist`. `node --import tsx/loader.mjs run.ts`
  를 직접 실행한다 — launchd의 `/bin/sh`는 macOS TCC 때문에 `~/Documents` 안 레포를 못 읽는다
  (exit 126, 2026-11-04). node는 허용돼 있다.
- **윈도우**: 작업 `cinemo-watch-<이름>` (`schtasks /sc minute`) → `conhost.exe --headless scripts\watch-run.cmd <이름>`
  (창 안 뜸). 로그온 세션에서 돈다(인스타 배치와 같은 방식). node 기동 실패는 `%LOCALAPPDATA%\cinemo-watch.err.log`.
