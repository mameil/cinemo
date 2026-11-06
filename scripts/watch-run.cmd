@echo off
rem 로컬 감시 1회 실행 — 윈도우 작업 스케줄러가 호출 (등록: pnpm --filter @cinemo/crawler watch-agent -- add ...)
rem   watch-run.cmd <감시 이름>
rem 결과는 %LOCALAPPDATA%\cinemo-watch.log. node 기동 자체가 실패하면 cinemo-watch.err.log 에 남는다.
cd /d "%~dp0..\packages\crawler" || exit /b 1
node --import tsx src\watch\run.ts %1 1>nul 2>>"%LOCALAPPDATA%\cinemo-watch.err.log"
