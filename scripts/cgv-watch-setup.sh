#!/bin/sh
# CGV 예매 오픈 감시 — macOS launchd 등록 (1분 주기)
#
# GitHub Actions(10분, 메일)와 이중화되는 고빈도 경로. 맥이 켜져 있는 동안만 돈다.
# plist를 이 맥의 실제 경로로 생성하므로 클론 위치에 무관하다(집/회사 교대 대비).
# 재실행하면 교체(idempotent).
#
#   등록:      sh scripts/cgv-watch-setup.sh
#   다른 대상: WATCH_DATE=2026-10-11 WATCH_MOVIE=토리노의말 sh scripts/cgv-watch-setup.sh
#   즉시 1회:  launchctl start com.cinemo.cgv-watch
#   상태:      launchctl list | grep cgv-watch
#   제거:      sh scripts/cgv-watch-setup.sh --remove
#   로그:      ~/Library/Logs/cinemo-cgv-watch.log
#
# ⚠️ 티켓을 잡았으면 반드시 --remove 할 것. 날짜가 지나면 감시는 조용히 통과하지만
#    1분마다 pnpm 프로세스가 계속 뜨는 건 낭비다.
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
WRAPPER="$REPO_ROOT/scripts/cgv-watch-local.sh"
LABEL="com.cinemo.cgv-watch"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LAUNCHD_LOG="$HOME/Library/Logs/cinemo-cgv-watch.launchd.log"

if [ "${1:-}" = "--remove" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "제거 완료: $LABEL"
  echo "알림 마커도 지우려면: rm -rf ~/.cinemo/cgv-watch"
  exit 0
fi

# ── 감시 대상 (plist에 박제한다 — 셸 환경에 의존하면 launchd에서 풀린다) ──
WATCH_SITE="${WATCH_SITE:-0040}"        # CGV 압구정
WATCH_DATE="${WATCH_DATE:-2026-10-09}"
WATCH_MOVIE="${WATCH_MOVIE:-사탄탱고}"

[ -f "$WRAPPER" ] || { echo "래퍼 없음: $WRAPPER"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "pnpm 이 PATH에 없음 — brew install node && corepack enable"; exit 1; }
[ -x "${CURL_IMPERSONATE_BIN:-$HOME/.local/bin/curl-impersonate}" ] || {
  echo "⚠️ curl-impersonate 없음 — CGV는 Cloudflare 우회가 필요합니다."
  echo "   lexiforest/curl-impersonate 릴리스를 ~/.local/bin/curl-impersonate 로 받으세요."
  exit 1
}

echo "의존성 설치 중…"
(cd "$REPO_ROOT" && pnpm install --frozen-lockfile) >/dev/null || { echo "pnpm install 실패"; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array><string>/bin/sh</string><string>$WRAPPER</string></array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>WATCH_SITE</key><string>$WATCH_SITE</string>
        <key>WATCH_DATE</key><string>$WATCH_DATE</string>
        <key>WATCH_MOVIE</key><string>$WATCH_MOVIE</string>
        <key>CURL_IMPERSONATE_BIN</key><string>${CURL_IMPERSONATE_BIN:-$HOME/.local/bin/curl-impersonate}</string>
    </dict>
    <key>StartInterval</key><integer>60</integer>
    <key>RunAtLoad</key><true/>
    <key>StandardOutPath</key><string>$LAUNCHD_LOG</string>
    <key>StandardErrorPath</key><string>$LAUNCHD_LOG</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST" >/dev/null
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "등록 완료: $LABEL — 1분마다"
echo "  대상: siteNo=$WATCH_SITE · $WATCH_DATE · \"$WATCH_MOVIE\""
echo "  로그: $HOME/Library/Logs/cinemo-cgv-watch.log"
echo "  제거: sh scripts/cgv-watch-setup.sh --remove"
