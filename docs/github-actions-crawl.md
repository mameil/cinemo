# GitHub Actions 크롤 자동화 가이드

크롤러(`pnpm crawl`)를 GitHub이 정해진 시간마다 자동으로 돌려서 DB를 최신으로 유지하는 설정이다.
처음 GitHub Actions를 접하는 사람을 위해 **개념 → 우리 설정 → 사용법** 순으로 정리한다.

---

## 1. 개념

### GitHub Actions란

GitHub이 무료로 빌려주는 **"자동 실행 컴퓨터"**. 레포에 `.github/workflows/*.yml` 파일을 두면,
특정 조건에서 GitHub이 임시 서버(러너)를 띄워 시킨 명령을 실행하고 끝나면 끈다.
내 PC가 꺼져 있어도 GitHub 서버에서 돌아간다.

### cron이란

**"몇 시에 실행해"** 를 정의하는 스케줄 문법. 다섯 칸이 각각 `분 시 일 월 요일`.

```
0 */3 * * *   →  3시간마다 (매 0분)
0 0 * * *     →  매일 자정
0 9 * * 1     →  매주 월요일 9시
```

### 왜 필요한가

`pnpm crawl`은 한 번 돌리면 **그 순간의 데이터**만 DB에 넣는다. 그런데 현실은 계속 변한다:

- 굿즈 소진현황이 실시간으로 바뀜 (강남점 92개 → 몇 시간 뒤 소진)
- 새 특전 이벤트가 계속 올라오고, 지난 이벤트는 끝남

이걸 사람이 매번 손으로 돌릴 수 없으니, **GitHub이 3시간마다 알아서 크롤러를 돌려 DB를 최신으로 유지**하게 한 것이다.
우리 크롤러는 upsert(멱등) 방식이라 몇 번을 돌려도 중복이 생기지 않아 자동 반복에 안전하다.

### 요금

- **Public 레포**: 무제한 무료
- **Private 레포**(우리): 월 **2,000분** 무료, 초과 시 유료
  → 우리는 3시간 주기 = 월 ~240회 × 회당 ~5분 ≈ **1,200분**으로 예산 안에 있음

> 레포를 왜 private으로 두는지: 과거 커밋 히스토리에 API 키가 포함돼 있어, public 전환 전에
> 키 재발급 + 히스토리 세탁이 필요하기 때문. (자세한 건 `docs/ingest-tasks.md`의 "나중 개선사항" 참고)

---

## 2. 우리가 어떻게 설정했나

설정 파일: **`.github/workflows/crawl.yml`**

### 언제 실행되나 (트리거 2개)

```yaml
on:
  schedule:
    - cron: "0 */3 * * *"   # 3시간마다
  workflow_dispatch: {}      # 수동 실행 버튼
```

- **schedule**: 3시간마다 자동. cron은 **UTC 기준**이지만, 한국시간(UTC+9)의 9가 3의 배수라
  결과적으로 한국시간 **0·3·6·9·12·15·18·21시**에 정확히 맞아떨어진다.
- **workflow_dispatch**: Actions 탭에서 버튼으로 직접 실행 (= 수동 refresh 수단).

### 무엇을 실행하나 (스텝)

러너(ubuntu-latest)에서 순서대로:

1. **checkout** — 레포 코드 받기
2. **pnpm + Node 22 세팅** (의존성 캐시 포함)
3. **`pnpm install`** — 패키지 설치
4. **curl-impersonate 설치** — CGV Cloudflare 우회용. CI는 리눅스라 `x86_64-linux-gnu` 바이너리를
   내려받아 `~/.local/bin`에 둔다. (로컬 맥은 arm64 바이너리라 서로 다름)
5. **`pnpm crawl`** — 실제 파이프라인 실행. [3사 수집·적재 → KOBIS 백필 → TMDB 포스터]

### 비밀값은 어떻게 주입하나

`.env`는 gitignore돼서 CI에 없다. 대신 **GitHub Secrets**에 등록한 값을 `env`로 주입한다:

```yaml
env:
  TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
  TURSO_AUTH_TOKEN:   ${{ secrets.TURSO_AUTH_TOKEN }}
  ...
```

### 안전장치

| 설정 | 의미 |
|---|---|
| `concurrency: { group: crawl, cancel-in-progress: false }` | 실행이 겹치지 않게 함 (이전 게 안 끝나면 대기) |
| `timeout-minutes: 15` | 멈춘 실행이 무료 분량을 잡아먹지 않게 15분 상한 |
| `permissions: { contents: read }` | 워크플로우에 최소 권한만 부여 |

---

## 2-1. 두 번째 워크플로우 — 상영시간표 (schedule.yml)

굿즈 크롤과 **분리된** 별도 잡. 상영시간표는 무겁고(수도권 전체 시 수십 분) 1주일 앞까지만
열려서 **하루 1회**만 돌린다.

- 트리거: 매일 `0 4 * * *`(UTC) = **한국시간 13:00** + 수동 실행
- 실행: `pnpm crawl:schedule` → 롯데/메가/CGV 상영을 순차 수집·적재
- **수집 범위**: 기본은 **구역**(일산/서울 서부, `schedule-all.ts`의 `DEFAULT_ZONE`).
  - 무료 예산(월 2,000분) 때문에 수도권 전체 매일 수집은 불가(3사 합쳐 하루 1.5~2시간).
  - 넓히려면: 레포 **Variables**에 `SCHEDULE_ONLY`(쉼표구분 지점 키워드) 설정, 또는
    `pnpm crawl:schedule -- --all`(수도권 전체, 예산 주의).
- 실패 시 exit 1 → 굿즈 크롤과 동일하게 GitHub 알림 + Job Summary 표.

> 즉 자동화는 **크론 2개**: 굿즈/소진(3시간) + 상영시간표(하루 1회).

## 3. 사용법

### (최초 1회) GitHub Secrets 등록

CI가 DB/API에 접속하려면 키 5개를 레포에 등록해야 한다. **본인 계정 권한이 필요**하다.

**방법 A — 웹**
레포 → **Settings → Secrets and variables → Actions → New repository secret** 에서 5개 등록
(`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TMDB_API_KEY`, `TMDB_ACCESS_TOKEN`, `KOBIS_API_KEY`).
값은 로컬 `.env`에 있는 그대로.

**방법 B — CLI (한 번에)**
```bash
gh auth login   # 최초 1회 인증
# .env에서 읽어 5개 자동 등록
grep -E '^(TURSO_DATABASE_URL|TURSO_AUTH_TOKEN|TMDB_API_KEY|TMDB_ACCESS_TOKEN|KOBIS_API_KEY)=' .env \
  | while IFS='=' read -r k v; do gh secret set "$k" --body "$v"; done
```

### 수동 실행 (직접 refresh)

GitHub 레포 → **Actions 탭 → 왼쪽 "crawl" → 우측 "Run workflow" 버튼** 클릭.
즉시 한 번 돌아간다. (스케줄을 기다리지 않고 지금 데이터를 갱신하고 싶을 때)

### 실행 결과·로그 보기

Actions 탭 → crawl → 실행 항목 클릭 → 스텝별 로그 확인.
맨 아래 `Run crawl pipeline` 로그에 체인별 적재 건수가 찍힌다:
```
CGV: 이벤트 35 / 굿즈 34 / 소진 639 / 지점 79
...
```
- ✅ 초록 = 성공, ❌ 빨강 = 실패(로그에서 어느 스텝인지 확인).

### 주기 바꾸기

`.github/workflows/crawl.yml`의 cron 값만 수정하고 커밋:
```yaml
- cron: "0 */3 * * *"   # 3시간 → "0 */6 * * *"로 바꾸면 6시간마다
```

### 마지막 수집 시각 확인

별도 기록 없이 DB에서 도출 가능:
```sql
SELECT MAX(updated_at) FROM goods_stock;
```
(향후 웹 화면에 "마지막 업데이트: n시간 전"으로 표시할 예정 — `docs/ingest-tasks.md` 참고)

---

## 4. 실패 알림 / 모니터링

배치가 3시간마다 무인 실행되므로, 실패를 놓치지 않게 알림을 받는다.

### 동작 방식

- 오케스트레이터(`pnpm crawl`)가 단계별(CGV/롯데/메가 수집·적재, KOBIS 백필, TMDB 포스터)로
  성공/실패를 추적하고, **진짜 실패가 하나라도 있으면 `exit 1`** 로 끝난다 → 잡이 빨간불.
- TMDB/KOBIS **데이터 미매칭**(`✗ 검색 결과 없음`)은 실패로 치지 않는다(정상 동작).
  한 체인이 통째로 터지거나 DB 적재 에러 같은 경우만 실패.
- 한 단계가 실패해도 나머지 단계는 계속 실행된다(에러 격리).
- 실행마다 단계별 결과 표를 **Job Summary**로 남긴다. 실행 페이지 상단에서 이렇게 보인다:

  > ## 크롤 결과 — ❌ 실패 1건
  > | 상태 | 단계 | 상세 |
  > | ❌ | CGV 수집·적재 | ...에러 원인... |
  > | ✅ | 롯데시네마 수집·적재 | 이벤트 39 / ... |

### 알림 받기 (GitHub 네이티브, 별도 연동 불필요)

- **성공 시**: 알림 없음 (3시간마다 성공 알림은 소음이라 의도적으로 안 보냄)
- **실패 시**: GitHub이 이메일 + (앱 설치 시) **모바일 push** 발송

설정 방법:
1. **GitHub 모바일 앱**(iOS/Android) 설치 후 로그인
2. GitHub 웹 → 우상단 프로필 → **Settings → Notifications → Actions**
   → "Send notifications for: **Only failed workflows**" 선택 (이메일/웹 체크)
3. 모바일 앱 설정에서 push 알림 허용

> 스케줄 워크플로우 실패 알림은 **워크플로우 파일을 마지막으로 커밋한 사람**에게 간다.
> 실패 알림을 탭하면 해당 실행의 Job Summary(위 표)로 이동해 어느 단계가 왜 터졌는지 바로 확인.

### 더 풍부한 알림 (희망사항 — 보류)

현재 GitHub 기본 알림의 한계:
- 성공 시엔 알림이 없다 (성공 메시지 불가)
- 잡의 성공/실패만 감지 → "정상 실행됐지만 TMDB 포스터 5건 못 찾음" 같은 **데이터 레벨 이슈**는 알 수 없다

원하는 것(향후 구현):
- **매 실행마다** 성공/실패 상관없이 요약 수신
- 포스터 매칭 실패한 영화 목록 등 데이터 레벨 상세 포함

구현 방법: 워크플로우 끝에 Telegram/Discord/Slack webhook 스텝(`if: always()`)을 추가하고,
`syncMovies`/`backfill`이 결과(매칭/실패 건수, 실패 제목)를 반환하도록 고쳐 메시지에 포함.
채널 미정으로 지금은 보류. (`docs/ingest-tasks.md`의 나중 개선사항에도 기록)

## 5. 알아둘 점 / 트러블슈팅

- **첫 스케줄은 파일이 기본 브랜치(master)에 올라간 뒤부터** 잡힌다. 등록 직후엔 수동 실행으로 검증 권장.
- **cron은 정시 보장이 아니다** — GitHub 부하 상황에서 몇 분~수십 분 밀릴 수 있다.
- **60일 미활동 시 스케줄 자동 중지** — 레포에 오래 커밋이 없으면 GitHub이 스케줄을 끈다. 다시 push하면 재활성.
- **Secrets 누락 시 실패** — `Run crawl pipeline` 스텝에서 DB 연결 에러(`URL_INVALID` 등)가 나면 Secrets 등록을 확인.
- **CGV 403 재발 시** — Cloudflare가 curl-impersonate 지문까지 막으면 `crawl.yml`의 curl-impersonate 버전/impersonate 대상을 갱신해야 할 수 있다. (`packages/crawler/src/cgv/api.ts` 참고)
- **무료 분량 확인** — 레포 Settings → Billing에서 Actions 사용량 확인 가능.
