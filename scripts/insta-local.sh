#!/bin/sh
# 인스타 로컬 수집 (Apify 대체 — C안, 2026-08-07) · launchd 데일리 실행용 래퍼
#
# 집 맥(주거용 IP)에서 무로그인으로 독립영화관 인스타를 수집한다. Apify 크레딧을
# 쓰지 않는다. 자기 위치에서 레포 루트를 유도하므로 클론 경로에 무관하게 동작한다
# (집/회사 PC 교대 사용 대비). dedup(raw_posts)이 있어 양쪽 PC에 걸어도 안전.
#
# 수동 실행:   sh scripts/insta-local.sh
# 캐치업:      INSTA_MAX=10 sh scripts/insta-local.sh
# 폴링(요청 시만): INSTA_POLL=1 sh scripts/insta-local.sh  (5분 주기 스케줄러가 호출)
# 로그:        ~/Library/Logs/cinemo-insta-local.log
set -u

# 폴 모드: 어드민 실행 요청이 있을 때만 수집(없으면 즉시 종료). 5분 폴러가 INSTA_POLL=1로 호출.
POLL_ARG=""
[ "${INSTA_POLL:-}" = "1" ] && POLL_ARG="--poll"

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

# launchd는 최소 PATH만 넘기므로 homebrew(pnpm/node)를 명시적으로 추가한다.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

LOG="$HOME/Library/Logs/cinemo-insta-local.log"
mkdir -p "$(dirname "$LOG")"

echo "===== $(date '+%Y-%m-%d %H:%M:%S') 인스타 로컬 수집 시작 (max=${INSTA_MAX:-2}${POLL_ARG:+ · poll}) =====" >> "$LOG"

cd "$REPO_ROOT" || { echo "레포 루트 진입 실패: $REPO_ROOT" >> "$LOG"; exit 1; }

# --local: 집 맥 Chrome으로 무로그인 수집. .env는 pnpm insta 스크립트가 ../../.env로 로드.
pnpm --filter @cinemo/crawler insta -- --local --max="${INSTA_MAX:-2}" $POLL_ARG >> "$LOG" 2>&1
STATUS=$?

echo "===== $(date '+%Y-%m-%d %H:%M:%S') 종료 (exit $STATUS) =====" >> "$LOG"
exit $STATUS
