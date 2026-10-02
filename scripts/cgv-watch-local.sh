#!/bin/sh
# CGV 예매 오픈 감시 — 로컬(맥) 1분 주기 래퍼
#
# GitHub Actions(10분, 메일)와 이중화되는 고빈도 경로. 맥이 켜져 있는 동안만 돈다.
# 감지되면 **알림센터 + 소리 + 음성 + 브라우저 열기** 네 겹으로 알려서 맥 앞에 있으면 못 놓친다.
# (자리에 없을 때는 GH Actions 메일이 받아낸다 — 그래서 둘을 같이 돌린다)
#
# 수동 실행:   sh scripts/cgv-watch-local.sh
# 다른 대상:   WATCH_SITE=0013 WATCH_DATE=2026-10-11 WATCH_MOVIE=토리노의말 sh scripts/cgv-watch-local.sh
# 알림 리셋:   rm -rf ~/.cinemo/cgv-watch        (다시 알림받고 싶을 때)
# 로그:        ~/Library/Logs/cinemo-cgv-watch.log
set -u

# ── 감시 대상 (launchd plist가 env로 덮어쓴다) ──
WATCH_SITE="${WATCH_SITE:-0040}"        # CGV 압구정 (씨네드쉐프 압구정 P001과 다름)
WATCH_DATE="${WATCH_DATE:-2026-10-09}"
WATCH_MOVIE="${WATCH_MOVIE:-사탄탱고}"
# 같은 건으로 몇 번까지 알릴지 — 1회만 하면 소리를 놓쳤을 때 복구가 안 되고,
# 무제한이면 1분마다 평생 울린다. 5회(=5분)면 자리에 있으면 반드시 인지한다.
MAX_ALERTS="${WATCH_MAX_ALERTS:-5}"
# 알림 수단 토글 — 조용한 환경(회의 중 등)이나 동작 확인용. 알림센터+소리는 항상 간다.
WATCH_VOICE="${WATCH_VOICE:-1}"     # 0 = 음성(say) 끔
WATCH_BROWSER="${WATCH_BROWSER:-1}" # 0 = 브라우저 자동 열기 끔

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

# launchd는 최소 PATH만 넘기므로 homebrew(pnpm/node)를 명시적으로 추가한다.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

LOG="$HOME/Library/Logs/cinemo-cgv-watch.log"
STATE_DIR="$HOME/.cinemo/cgv-watch"
# 대상이 바뀌면 마커도 바뀌어야 하므로 키에 대상을 박는다.
# 영화명은 한글이라 파일명에 그대로 못 쓴다 — 바이트를 치환하면 제목이 전부 "____"로
# 뭉개져 서로 다른 영화가 같은 마커를 공유한다(실제로 그랬다).
# 해시는 cksum(/usr/bin) 사용 — macOS의 md5는 /sbin 에 있어서 위에서 고정한 PATH에 안 잡힌다.
MOVIE_HASH=$(printf '%s' "$WATCH_MOVIE" | cksum | cut -d' ' -f1)
KEY="$WATCH_SITE-$WATCH_DATE-$MOVIE_HASH"
ALERT_COUNT_FILE="$STATE_DIR/alert-$KEY"
ERROR_MARKER="$STATE_DIR/error-$KEY"
mkdir -p "$(dirname "$LOG")" "$STATE_DIR"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
logln() { echo "$(ts) $*" >> "$LOG"; }

# macOS 알림 — 따옴표/백슬래시를 AppleScript 문자열로 이스케이프
notify() {
  _title=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  _body=$(printf '%s' "$2" | sed 's/\\/\\\\/g; s/"/\\"/g')
  osascript -e "display notification \"$_body\" with title \"$_title\" sound name \"Glass\"" 2>>"$LOG"
}

# ── 이미 충분히 알렸으면 조용히 통과 ──
COUNT=0
[ -f "$ALERT_COUNT_FILE" ] && COUNT=$(cat "$ALERT_COUNT_FILE" 2>/dev/null || echo 0)
if [ "$COUNT" -ge "$MAX_ALERTS" ]; then
  logln "알림 ${COUNT}회 완료 — 통과 (리셋: rm -rf $STATE_DIR)"
  exit 0
fi

cd "$REPO_ROOT" || { logln "레포 루트 진입 실패: $REPO_ROOT"; exit 1; }

OUT=$(mktemp)
SUMMARY=$(mktemp)
RAW=$(mktemp)
trap 'rm -f "$OUT" "$SUMMARY" "$RAW"' EXIT

WATCH_SITE="$WATCH_SITE" WATCH_DATE="$WATCH_DATE" WATCH_MOVIE="$WATCH_MOVIE" \
  WATCH_OUT="$OUT" WATCH_SUMMARY="$SUMMARY" \
  pnpm --filter @cinemo/crawler cgv-watch > "$RAW" 2>&1
STATUS=$?

ALERT=$(grep -m1 '^alert=' "$OUT" 2>/dev/null | cut -d= -f2)
FOUND=$(grep -m1 '^found=' "$OUT" 2>/dev/null | cut -d= -f2)
ERRORED=$(grep -m1 '^error=' "$OUT" 2>/dev/null | cut -d= -f2)

# ── 수집 실패 — 1회만 알린다(1분마다 울리면 못 쓴다) ──
if [ "$ERRORED" = "true" ] || { [ "$STATUS" -eq 2 ] && [ "$ALERT" != "true" ]; }; then
  if [ ! -f "$ERROR_MARKER" ]; then
    : > "$ERROR_MARKER"
    notify "⚠️ CGV 감시 실패" "$WATCH_MOVIE 감시가 깨졌습니다. 로그 확인: $LOG"
    logln "수집 실패 (exit $STATUS) — 알림 1회 발송"
    cat "$RAW" >> "$LOG"
  else
    logln "수집 실패 (exit $STATUS) — 이미 알림함"
  fi
  exit 0
fi

# ── 평상시 ──
if [ "$ALERT" != "true" ]; then
  logln "대기 — $WATCH_DATE $WATCH_MOVIE 미오픈"
  exit 0
fi

# ── 알람 ──
COUNT=$((COUNT + 1))
echo "$COUNT" > "$ALERT_COUNT_FILE"

# 회차 목록(ⓐ) 또는 편성 목록(ⓑ)에서 알림 본문 만들기 — 마크다운 불릿을 한 줄로 합친다
DETAIL=$(grep '^- ' "$SUMMARY" 2>/dev/null | sed 's/^- //' | head -3 | tr '\n' ' ')
if [ "$FOUND" = "true" ]; then
  TITLE="🎟 $WATCH_MOVIE $WATCH_DATE 예매 오픈!"
  VOICE="$WATCH_MOVIE 예매가 열렸습니다. 지금 예매하세요."
else
  TITLE="⚠️ $WATCH_DATE 열렸지만 $WATCH_MOVIE 없음"
  VOICE="$WATCH_DATE 예매가 열렸지만 $WATCH_MOVIE 는 편성에 없습니다."
fi

notify "$TITLE" "${DETAIL:-자세한 내용은 $LOG}"
# 소리를 놓쳐도 음성은 귀에 남는다 (알림 소리만으로는 자주 묻힌다)
[ "$WATCH_VOICE" = "1" ] && say "$VOICE" 2>>"$LOG" &

# 첫 알람에만 브라우저를 띄운다 — 매분 탭이 열리면 쓸 수 없다
if [ "$COUNT" -eq 1 ] && [ "$FOUND" = "true" ] && [ "$WATCH_BROWSER" = "1" ]; then
  open "https://cgv.co.kr" 2>>"$LOG"
fi

logln "★ 알람 $COUNT/$MAX_ALERTS — $TITLE"
cat "$RAW" >> "$LOG"
exit 0
