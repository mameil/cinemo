# 인스타 로컬 수집 배치 설치 가이드 (맥 / 윈도우)

독립영화관 인스타 수집을 **개인 PC에서 무로그인·무료로** 돌리는 배치(C안)의 설치법.
왜 이렇게 하는지(벤더=IP, dedup, 로그인 미도입 등)는 [설계서](설계서.md)의
"2026-08-07 — C안" 항목 참고.

> **집=맥 · 회사=윈도우 데스크탑 교대 사용을 전제.** 두 PC 모두 같은 Turso DB·R2에 쓰고,
> `raw_posts` media ID로 dedup되므로 **둘 다 걸어도 중복 없이 안전**하다. 깨어 있는 PC가
> 그날 수집을 커버 → 커버리지가 좋아진다.

## 공통 전제 (두 OS 공통, 1회)

1. 레포 클론 + 의존성: `pnpm install`
2. 레포 루트에 `.env` (Turso·TMDB·KOBIS·Gemini·R2 키 — `.env.example` 참고). **public 레포이므로 커밋 금지.**
3. **Google Chrome 설치** (puppeteer-core가 시스템 Chrome을 구동). 표준 경로에 없으면 `CHROME_BIN` 환경변수로 지정.
4. Node.js + pnpm (PATH에 있어야 함).

스케줄: **매시 정각 09~23시**. PC가 자고 있었으면 깨어난 뒤 밀린 슬롯을 1회 실행.
새 게시물이 없는 대부분의 실행은 그리드 dedup으로 프로필만 조회하고 끝난다(저부하).

---

## 🍎 macOS (launchd)

```sh
sh scripts/insta-local-setup.sh
```

이게 이 맥의 실제 경로로 `~/Library/LaunchAgents/com.cinemo.insta-local.plist`를 생성·로드한다.

| 작업 | 명령 |
|---|---|
| 즉시 1회 실행 | `launchctl start com.cinemo.insta-local` |
| 상태 확인 | `launchctl list \| grep cinemo` (마지막 열 = 직전 exit code) |
| 로그 | `~/Library/Logs/cinemo-insta-local.log` |
| 제거 | `launchctl unload ~/Library/LaunchAgents/com.cinemo.insta-local.plist` |

---

## 🪟 Windows (작업 스케줄러)

PowerShell에서:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\insta-local-setup.ps1
```

이게 `cinemo-insta-local` 작업을 매시 정각 09~23시로 등록한다(현재 로그인 사용자 컨텍스트).

| 작업 | 명령 |
|---|---|
| 즉시 1회 실행 | `Start-ScheduledTask -TaskName cinemo-insta-local` |
| 상태 확인 | `Get-ScheduledTaskInfo -TaskName cinemo-insta-local` |
| 로그 | `%LOCALAPPDATA%\cinemo-insta-local.log` |
| 제거 | `Unregister-ScheduledTask -TaskName cinemo-insta-local -Confirm:$false` |

수동/캐치업 실행(스케줄러 없이): `set INSTA_MAX=10 && scripts\insta-local.cmd`

---

## 🤖 Claude Code로 "알아서 걸기"

새 PC에서 레포를 풀 받은 뒤 Claude Code에게 이렇게 시키면 된다:

> **"인스타 로컬 배치 걸어줘"**

그러면 Claude가:
1. OS를 감지해 위 setup 스크립트(맥=`.sh` / 윈도우=`.ps1`)를 실행하고,
2. 전제(`.env`·Chrome·pnpm)를 점검한 뒤,
3. 즉시 1회 실행으로 로그가 정상인지 확인한다.

---

## 트러블슈팅

- **로그에 `URL_INVALID ... 'undefined'`** → `.env` 없음/경로 문제. 레포 루트에 `.env` 있는지 확인.
- **`Chrome ... not found` / 실행 실패** → Chrome 미설치거나 비표준 경로. `CHROME_BIN`으로 실행 파일 경로 지정.
- **로그에 `전 계정 프로필 접근 실패`** → 인스타가 익명 접근을 조인 신호. Apify 폴백(`insta.yml` `workflow_dispatch`)으로 임시 수집.
- **`pnpm`/`node` 없음(윈도우 스케줄러)** → 작업이 사용자 PATH를 못 볼 때. 사용자 로그인 상태에서 실행되는지, Node/pnpm이 사용자 PATH에 있는지 확인.
