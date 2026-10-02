#!/bin/sh
# CGV 예매 오픈 감시 — 로컬(맥) 1분 주기 래퍼
#
# GitHub Actions(10분, 메일)와 이중화되는 고빈도 경로. 맥이 켜져 있는 동안만 돈다.
# 감지되면 **알림센터 + 소리 + 음성 + 브라우저 열기** 네 겹으로 알려서 맥 앞에 있으면 못 놓친다.
# 자리에 없을 때를 위해 **폰 푸시(ntfy)** 도 같이 보낸다 — GitHub 크론은 실측상 지연·폐기가
# 심해서(3시간 크론이 3~45분씩 밀리고 절반은 버려짐) 원격 알림을 로컬이 직접 담당한다.
#
# 폰 푸시 설정: .env 에 WATCH_NTFY_TOPIC=<추측불가 토픽> 을 넣고, 폰에 ntfy 앱을 설치해
# 같은 토픽을 구독한다. 토픽을 아는 사람은 누구나 구독 가능하므로 **커밋 금지**(.env는 gitignore).
# 미설정이면 푸시만 조용히 건너뛰고 로컬 알림은 그대로 동작한다.
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

# 폰 푸시 토픽 — env 우선, 없으면 .env에서 읽는다(프로젝트 관례상 키는 루트 .env)
# 공백은 제거한다 — 공백만 든 값을 "설정됨"으로 보면 매 실행 HTTP 400을 맞는다
NTFY_TOPIC=$(printf '%s' "${WATCH_NTFY_TOPIC:-}" | tr -d '[:space:]')
if [ -z "$NTFY_TOPIC" ] && [ -f "$REPO_ROOT/.env" ]; then
  NTFY_TOPIC=$(grep -m1 '^WATCH_NTFY_TOPIC=' "$REPO_ROOT/.env" 2>/dev/null \
    | cut -d= -f2- | tr -d "\"'" | tr -d '[:space:]')
fi

# JSON 문자열 이스케이프 (제목·본문에 따옴표가 섞여도 깨지지 않게)
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

# 폰 푸시 — 헤더는 비ASCII에 취약하므로 UTF-8 안전한 JSON 발행 방식을 쓴다.
# $1=제목 $2=본문 $3=우선순위(5=최대)
push() {
  [ -n "$NTFY_TOPIC" ] || return 0
  _t=$(json_escape "$1"); _m=$(json_escape "$2")
  _code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "https://ntfy.sh" \
    -H "Content-Type: application/json" \
    -d "{\"topic\":\"$NTFY_TOPIC\",\"title\":\"$_t\",\"message\":\"$_m\",\"priority\":$3,\"tags\":[\"ticket\"],\"click\":\"https://cgv.co.kr\"}")
  if [ "$_code" = "200" ]; then logln "  ntfy 푸시 OK"; else logln "  ntfy 푸시 실패 (HTTP $_code)"; fi
}

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

# 감시기가 결과를 한 줄도 못 썼다 = 실행 자체가 안 됐다.
#   예: 이 워킹트리를 watch-open.ts 없는 브랜치로 바꿔둠 / 의존성 깨짐 / tsx 기동 실패.
# 이걸 "대기"로 로깅하면 죽은 감시를 정상으로 오인한다(가장 나쁜 실패) — 장애로 올린다.
if [ -z "$ALERT" ] && [ -z "$ERRORED" ]; then
  ERRORED=true
  logln "감시기가 결과를 쓰지 못함 — 실행 실패로 간주 (exit $STATUS)"
fi

# ── 수집 실패 — 1회만 알린다(1분마다 울리면 못 쓴다) ──
if [ "$ERRORED" = "true" ] || { [ "$STATUS" -eq 2 ] && [ "$ALERT" != "true" ]; }; then
  if [ ! -f "$ERROR_MARKER" ]; then
    : > "$ERROR_MARKER"
    notify "⚠️ CGV 감시 실패" "$WATCH_MOVIE 감시가 깨졌습니다. 로그 확인: $LOG"
    push "⚠️ CGV 감시 실패" "$WATCH_MOVIE $WATCH_DATE 감시가 깨졌습니다. 맥에서 로그 확인 필요." 3
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
# 자리에 없어도 받도록 폰 푸시. ⓐ는 최대 우선순위(5·방해금지 모드 관통), ⓑ는 높음(4).
[ "$FOUND" = "true" ] && PRIO=5 || PRIO=4
push "$TITLE" "${DETAIL:-$WATCH_MOVIE $WATCH_DATE}" "$PRIO"
# 소리를 놓쳐도 음성은 귀에 남는다 (알림 소리만으로는 자주 묻힌다)
[ "$WATCH_VOICE" = "1" ] && say "$VOICE" 2>>"$LOG" &

# 첫 알람에만 브라우저를 띄운다 — 매분 탭이 열리면 쓸 수 없다
if [ "$COUNT" -eq 1 ] && [ "$FOUND" = "true" ] && [ "$WATCH_BROWSER" = "1" ]; then
  open "https://cgv.co.kr" 2>>"$LOG"
fi

logln "★ 알람 $COUNT/$MAX_ALERTS — $TITLE"
cat "$RAW" >> "$LOG"
exit 0
