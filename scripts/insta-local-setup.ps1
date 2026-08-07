# 인스타 로컬 수집 — Windows 작업 스케줄러 등록 (C안, 크로스플랫폼)
#
# 회사 윈도우 데스크탑에서 1회 실행하면 "매시 정각 09~23시" 작업이 등록된다.
# 맥의 launchd(insta-local-setup.sh)와 대칭. 재실행하면 기존 작업을 교체(idempotent).
#
#   실행:  powershell -ExecutionPolicy Bypass -File scripts\insta-local-setup.ps1
#   제거:  Unregister-ScheduledTask -TaskName cinemo-insta-local -Confirm:$false
#   즉시 1회:  Start-ScheduledTask -TaskName cinemo-insta-local
#   상태:  Get-ScheduledTaskInfo -TaskName cinemo-insta-local
#   로그:  %LOCALAPPDATA%\cinemo-insta-local.log

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Wrapper  = Join-Path $RepoRoot "scripts\insta-local.cmd"
$TaskName = "cinemo-insta-local"

if (-not (Test-Path $Wrapper)) { throw "래퍼 없음: $Wrapper (레포를 풀 받았는지 확인)" }
if (-not (Test-Path (Join-Path $RepoRoot ".env"))) {
    Write-Warning ".env 없음 — Turso/TMDB/Gemini/R2 키가 있어야 수집이 적재됩니다. .env.example 참고."
}

# 사전 점검: pnpm / node / Chrome
foreach ($bin in @("pnpm", "node")) {
    if (-not (Get-Command $bin -ErrorAction SilentlyContinue)) {
        throw "$bin 이(가) PATH에 없음 — Node.js + pnpm 설치 후 다시 실행하세요."
    }
}
$chrome = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
    Write-Warning "Chrome 실행 파일을 표준 경로에서 못 찾음 — 설치돼 있으면 CHROME_BIN 환경변수로 지정하세요."
} else {
    Write-Host "Chrome: $chrome"
}

# 09~23시 매시 정각 트리거 15개 (맥 launchd StartCalendarInterval과 동일)
$triggers = 9..23 | ForEach-Object {
    New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours($_))
}
# cmd.exe /c "<wrapper>" 로 래퍼 실행
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\cmd.exe" -Argument "/c `"$Wrapper`""
# 예약 시각에 PC가 꺼져/자고 있었으면 켜진 뒤 밀린 실행 1회 (launchd 코얼레싱과 동일 취지)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
    -MultipleInstances IgnoreNew
# 현재 로그인 사용자 컨텍스트로 실행(사용자 PATH·프로필 상속 → pnpm/node 인식)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

# 기존 작업 있으면 교체
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Trigger $triggers -Action $action `
    -Settings $settings -Principal $principal `
    -Description "cinemo 인스타 로컬 수집 (매시 정각 09~23시, Apify 대체)" | Out-Null

Write-Host ""
Write-Host "등록 완료: $TaskName (매시 정각 09~23시)"
Write-Host "즉시 1회 실행:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "로그:           $env:LOCALAPPDATA\cinemo-insta-local.log"
