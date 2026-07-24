@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

echo ==========================================
echo  BlockMesh - BLOCK NOW (direct, live)
echo  Skips plan/simulate. Validates, then blocks
echo  real pairs and shows live speed in this window.
echo ==========================================
echo.

if not exist cookies.txt (
  echo [ERROR] cookies.txt not found in this folder.
  pause
  exit /b 1
)

REM Speed profile: balanced ^| fast ^| turbo  (default balanced)
set "MODE=%~1"
if "%MODE%"=="" set "MODE=balanced"

echo Speed profile: %MODE%
echo This WILL send real block requests to Roblox for every usable account pair.
set /p CONFIRM=Type YES to start blocking now:
if /i not "%CONFIRM%"=="YES" (
  echo Cancelled. Nothing was sent.
  pause
  exit /b 0
)

echo.
echo === Blocking (live). Per-pair result + a [progress] speed line every 5s. ===
echo.

node "block-mesh.js" apply --cookies cookies.txt --mode %MODE% --allow-unverified-blocklist --skip-block-list-check

echo.
echo === Done. Full report saved in reports\ , summary in diagnostics\latest-summary.txt ===
pause
