@echo off
rem 인스타 로컬 수집 (Apify 대체 — C안) · Windows 작업 스케줄러 실행용 래퍼
rem
rem 회사 윈도우 데스크탑에서 무로그인으로 독립영화관 인스타를 수집한다. Apify 크레딧 미사용.
rem 자기 위치에서 레포 루트를 유도하므로 클론 경로에 무관하게 동작(집 맥과 대칭).
rem 맥 래퍼(insta-local.sh)와 동일 동작. dedup(raw_posts)이 있어 두 PC 동시 가동도 안전.
rem
rem 수동 실행:   scripts\insta-local.cmd
rem 캐치업:      set INSTA_MAX=10 && scripts\insta-local.cmd
rem 로그:        %LOCALAPPDATA%\cinemo-insta-local.log
setlocal

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "REPO_ROOT=%%~fI"

if "%INSTA_MAX%"=="" set "INSTA_MAX=2"
set "LOG=%LOCALAPPDATA%\cinemo-insta-local.log"
rem pnpm insta 스크립트는 POSIX 인라인 env(VAR=val cmd)라 Windows에서 안 먹는다.
rem 대신 절대경로 .env를 지정하고 tsx를 pnpm exec로 직접 호출한다(cwd 무관).
set "DOTENV_CONFIG_PATH=%REPO_ROOT%\.env"

rem 폴 모드: 어드민 실행 요청 있을 때만 수집. 5분 폴러가 INSTA_POLL=1로 호출.
rem `set INSTA_POLL=1 & ...` 는 값에 뒤 공백이 붙으므로 값 비교 대신 defined 로 판정.
set "POLL_ARG="
if defined INSTA_POLL set "POLL_ARG=--poll"

echo ===== %date% %time% 인스타 로컬 수집 시작 (max=%INSTA_MAX% %POLL_ARG%) ===== >> "%LOG%"

cd /d "%REPO_ROOT%" || (echo 레포 루트 진입 실패: %REPO_ROOT% >> "%LOG%" & exit /b 1)

call pnpm --filter @cinemo/crawler exec tsx --require dotenv/config src/insta/index.ts -- --local --max=%INSTA_MAX% %POLL_ARG% >> "%LOG%" 2>&1
set "STATUS=%ERRORLEVEL%"

echo ===== %date% %time% 종료 (exit %STATUS%) ===== >> "%LOG%"
exit /b %STATUS%
