#!/bin/sh
# 인스타 로컬 수집 — macOS launchd 등록 (C안, 크로스플랫폼)
#
# 집 맥에서 1회 실행하면 "매시 정각 09~23시" 에이전트가 등록된다.
# 윈도우의 작업 스케줄러(insta-local-setup.ps1)와 대칭. 재실행하면 교체(idempotent).
# plist를 이 맥의 실제 경로로 생성하므로 클론 위치에 무관하다(두 맥 교대 대비).
#
#   실행:      sh scripts/insta-local-setup.sh
#   제거:      launchctl unload ~/Library/LaunchAgents/com.cinemo.insta-local.plist
#   즉시 1회:  launchctl start com.cinemo.insta-local
#   로그:      ~/Library/Logs/cinemo-insta-local.log
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
WRAPPER="$REPO_ROOT/scripts/insta-local.sh"
LABEL="com.cinemo.insta-local"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LAUNCHD_LOG="$HOME/Library/Logs/cinemo-insta-local.launchd.log"

[ -f "$WRAPPER" ] || { echo "래퍼 없음: $WRAPPER (레포를 풀 받았는지 확인)"; exit 1; }
[ -f "$REPO_ROOT/.env" ] || echo "⚠️ .env 없음 — Turso/TMDB/Gemini/R2 키 필요 (.env.example 참고)"
command -v pnpm >/dev/null 2>&1 || { echo "pnpm 이 PATH에 없음 — 설치 후 다시 실행"; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

# 09~23시 매시 정각 트리거 생성
TRIGGERS=""
h=9
while [ "$h" -le 23 ]; do
  TRIGGERS="$TRIGGERS        <dict><key>Hour</key><integer>$h</integer><key>Minute</key><integer>0</integer></dict>
"
  h=$((h + 1))
done

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array><string>/bin/sh</string><string>$WRAPPER</string></array>
    <key>StartCalendarInterval</key>
    <array>
$TRIGGERS    </array>
    <key>RunAtLoad</key><false/>
    <key>StandardOutPath</key><string>$LAUNCHD_LOG</string>
    <key>StandardErrorPath</key><string>$LAUNCHD_LOG</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST" >/dev/null
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "등록 완료: $LABEL (매시 정각 09~23시)"
echo "즉시 1회 실행:  launchctl start $LABEL"
echo "로그:           $HOME/Library/Logs/cinemo-insta-local.log"
