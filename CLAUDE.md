# CLAUDE.md

영화관별 **상영시간표 + 특전(굿즈)** 을 지역·날짜로 모아보는 서비스.
크롤러가 3사 데이터를 수집·정규화해 Turso(SQLite)에 적재하고, GitHub Actions 크론이 자동 갱신한다.

## 문서 (먼저 읽을 것)

- **[docs/PROJECT-STATUS.md](docs/PROJECT-STATUS.md)** — 진행 현황·아키텍처·데이터 모델·한계·다음 단계. **작업 시작 전 필독.**
- **[docs/특전-노출-규칙.md](docs/특전-노출-규칙.md)** — 특전 노출 판단 기준 (시간표 기준 · 극장/기간/재고 AND). **특전 관련 작업 시 필독.**
- [docs/설계서.md](docs/설계서.md) — 전체 설계 / [docs/api-spec.yaml](docs/api-spec.yaml) — 조회 API 스펙(Phase 3)
- 작업 로그: [ingest-tasks.md](docs/ingest-tasks.md)(특전 적재) · [showtime-tasks.md](docs/showtime-tasks.md)(상영) · [github-actions-crawl.md](docs/github-actions-crawl.md)(자동화) · [frontend-tasks.md](docs/frontend-tasks.md)(웹)

## 구조 (pnpm 모노레포)

- `packages/shared/` — Drizzle 스키마 · DB 클라이언트 · TMDB
- `packages/crawler/` — 크롤러 · 정규화 · 적재 (`domain.ts` 공통 타입, `db/repo.ts` upsert/ingest, `{cgv,lotte,megabox}/` 각 체인 `api.ts`+`collect.ts`(특전)+`schedule.ts`(상영), `index.ts` 굿즈 오케스트레이터, `schedule-all.ts` 상영 오케스트레이터)
- `apps/web/` — Next.js (Phase 3, 진행 중. 현재 `mock/`에 목업 데이터)

## 실행 명령

```bash
pnpm crawl                       # 특전/굿즈 전체: CGV·롯데·메가 → KOBIS 백필 → TMDB 포스터
pnpm crawl:schedule              # 상영시간표: 롯데·메가·CGV (기본 구역 = 일산/서울 서부)
pnpm crawl:schedule -- --all     # 상영 수도권 전체 (무거움 · 무료 예산 주의)
pnpm dev                         # 웹 개발 서버
```

개별 소스 실행 (모노레포 필터):
```bash
pnpm --filter @cinemo/crawler <cgv|lotte|megabox|kobis-backfill|tmdb|cgv-schedule|lotte-schedule|megabox-schedule|theater-geo>
```

크롤러 공통 플래그: `--dry`(적재 안 함) · `--max=N`(건수 제한) · `--only=극장1,극장2`(상영) · `--days=N`(상영 일수).
개발 중엔 **`--dry --max=3` 먼저** 돌려 확인 후 실제 적재.

**웹 타입체크는 반드시 `pnpm --filter @cinemo/web exec tsc --noEmit`** (크롤러는 `@cinemo/crawler`).
쉘 cwd가 명령 간 유지되어 `cd` 후 `pnpm exec tsc`를 엉뚱한 디렉토리에서 돌리면 가짜 에러 수백 줄이 난다 — filter 방식은 cwd 무관.

## 반드시 알아야 할 것

- **크롤러는 반드시 dotenv 경유로 실행.** `packages/crawler`에서 직접 파일을 돌릴 땐:
  `DOTENV_CONFIG_PATH=../../.env pnpm exec tsx --require dotenv/config src/<source>/index.ts`
  (위 `pnpm --filter` 스크립트가 이미 이걸 감싸므로, 가능하면 스크립트 사용.)
- **환경변수**는 루트 `.env` (예시: `.env.example`). Turso · TMDB · KOBIS 키 + `CURL_IMPERSONATE_BIN`.
- **CGV는 Cloudflare 우회 필요** — [lexiforest/curl-impersonate](https://github.com/lexiforest/curl-impersonate) 바이너리 경로를 `CURL_IMPERSONATE_BIN`에 지정. GitHub Actions에선 워크플로우가 자동 설치.
- **자동화**: `.github/workflows/crawl.yml`(풀 1회 + 경량 4회/일, 특전/굿즈) · `schedule.yml`(매일 13시 KST, 상영시간표) · `insta.yml`(매일 21시 KST, 독립영화관 인스타 — **Apify 폴백**). 실패 시 GitHub 기본 알림. public 레포라 Actions 분량 무제한 — 단 **Apify는 월 $5 무료**라 인스타는 예산 가드로 방어(80% 컷).
- **인스타 로컬 수집(C안)**: 인스타 주 수집은 이제 **개인 PC 로컬 배치**(무로그인 Chrome, Apify 크레딧 0). 집=맥(launchd)·회사=윈도우(작업 스케줄러) 하루 3회(10/15/20시). 사용자가 **"인스타 로컬 배치 걸어줘"** 하면 Claude가 자동 부트스트랩: OS 감지 → 없으면 Node·pnpm·Chrome **직접 설치**(winget/brew, 설치 후 새 셸로 PATH 반영) → `.env` 확인(공개 레포라 키 못 넣음 = **유일한 사람 손, 집 맥 `.env` 복사**) → `scripts/insta-local-setup.{sh,ps1}` 실행(`pnpm install`+스케줄러 등록) → 즉시 1회 실행 로그 확인. 런북: [docs/insta-local-setup.md](docs/insta-local-setup.md).
- **10분 넘는 장기 실행(시드 등)은 세션 백그라운드 금지** — 터미널 닫으면 같이 죽는다 (07-25 상상마당 시드 중단 사고). `nohup <명령> > /tmp/시드.log 2>&1 &`로 세션과 분리하고 로그 파일로 확인할 것.
- **배포**: Vercel — **https://mameil-cinemo.vercel.app** (master push 시 자동 배포, Root=apps/web, 환경변수는 Turso 2개만).
- 영화는 **제목 정규화로 교차 체인 dedup** 후 KOBIS/TMDB 백필. (`db/movie-match.ts`)

## 하네스 구축 (프로젝트 목적 중 하나)

이 프로젝트의 목적 중 하나는 **Claude Code 하네스 구축**이다. 작업 중 아래에 해당하는 게 보이면
그 자리에서 **"이거 하네스로 남길까요?"** 하고 사용자에게 기록 여부를 물어볼 것:

- 같은 명령/절차를 손으로 반복하고 있음 → 슬래시 커맨드·스크립트 후보
- 매번 같은 걸 다시 설명·재발견하고 있음 → CLAUDE.md/문서 후보
- 결정적으로 강제하고 싶은 동작 → hook 후보
- 반복되는 권한 프롬프트 → allowlist 후보

기록은 **[docs/harness-log.md](docs/harness-log.md)** 에 (후보→채택/기각). 새 세션 시작 시 이 파일의 "후보"를 훑어볼 것.

## 컨벤션

- **커밋 메시지는 한글**, Conventional Commits 접두사 사용 (`feat:` `fix:` `docs:` `chore:`).
- **커밋/푸시 요청 시 기록 컨펌**: 사용자가 커밋·푸시를 요청하면 바로 커밋하지 말고
  ① 이번 작업을 작업 로그(frontend-tasks.md 등)에 기록할지 묻고
  ② 기록한다면 **기록 문구를 먼저 보여주고 컨펌받은 뒤** 커밋한다.
- 레포는 **public** (`mameil/cinemo`, 2026-07-26 전환 — 키 박힌 옛 히스토리는 private `cinemo-archive`에 봉인, 로컬 `archive/master` 브랜치 = 옛 히스토리).
- **public이므로 키·토큰·개인정보 커밋 절대 금지.** 커밋 전 의심되면 `git grep`으로 확인. 커밋 이메일은 noreply(`57998468+mameil@users.noreply.github.com`) 유지.
