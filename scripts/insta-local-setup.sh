#!/bin/sh
# 인스타 로컬 수집 — macOS launchd 등록 (C안, 크로스플랫폼)
#
# 집 맥에서 1회 실행하면 "하루 3회(10/15/20시)" 에이전트가 등록된다.
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
command -v pnpm >/dev/null 2>&1 || { echo "pnpm 이 PATH에 없음 — Node.js+pnpm 설치 후 다시 실행 (brew install node && corepack enable)"; exit 1; }

# 의존성 설치 (turnkey — 이미 설치돼 있으면 빠르게 통과)
echo "의존성 설치 중…"
(cd "$REPO_ROOT" && pnpm install --frozen-lockfile) || { echo "pnpm install 실패"; exit 1; }

if [ ! -f "$REPO_ROOT/.env" ]; then
  echo "⚠️ .env 없음 — Turso/TMDB/KOBIS/Gemini/R2 키가 있어야 수집이 적재됩니다."
  echo "   집 맥의 $REPO_ROOT/.env 를 이 PC 레포 루트로 복사한 뒤 다시 실행하세요 (.env.example 참고)."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

# 하루 3회(10/15/20시) 트리거 — 인스타 IP 차단 완화(저빈도). 2026-08-09: 매시→3회로 축소.
TRIGGERS=""
for h in 10 15 20; do
  TRIGGERS="$TRIGGERS        <dict><key>Hour</key><integer>$h</integer><key>Minute</key><integer>0</integer></dict>
"
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

# ── 폴러 에이전트: 5분마다 어드민 실행 요청 확인 (요청 있을 때만 수집) ──
POLL_LABEL="com.cinemo.insta-poll"
POLL_PLIST="$HOME/Library/LaunchAgents/$POLL_LABEL.plist"
cat > "$POLL_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>Label</key><string>$POLL_LABEL</string>
    <key>ProgramArguments</key>
    <array><string>/bin/sh</string><string>$WRAPPER</string></array>
    <key>EnvironmentVariables</key><dict><key>INSTA_POLL</key><string>1</string></dict>
    <key>StartInterval</key><integer>300</integer>
    <key>RunAtLoad</key><false/>
    <key>StandardOutPath</key><string>$LAUNCHD_LOG</string>
    <key>StandardErrorPath</key><string>$LAUNCHD_LOG</string>
</dict>
</plist>
EOF
plutil -lint "$POLL_PLIST" >/dev/null
launchctl unload "$POLL_PLIST" 2>/dev/null || true
launchctl load "$POLL_PLIST"

echo "등록 완료: $LABEL (하루 3회(10/15/20시)) + $POLL_LABEL (5분 폴링)"
echo "즉시 1회 실행:  launchctl start $LABEL"
echo "로그:           $HOME/Library/Logs/cinemo-insta-local.log"
