@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

echo ==========================================
echo  BlockMesh - LIVE RUN
echo  This WILL send real block requests to Roblox
echo  for every account pair in cookies.txt.
echo ==========================================
echo.

if not exist cookies.txt (
  echo [ERROR] cookies.txt not found in this folder.
  echo Fill in your account cookies in cookies.txt first.
  pause
  exit /b 1
)

set /p CONFIRM=Type YES to start the live block run:
if /i not "%CONFIRM%"=="YES" (
  echo Cancelled. Nothing was sent.
  pause
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0one-click-auto.ps1" -Mode live -SpeedProfile balanced

echo.
echo Live run finished. Check the reports\ and diagnostics\ folders for results.
pause
