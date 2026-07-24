@echo off
chcp 65001 >nul 2>&1
setlocal
cd /d "%~dp0"

echo ==========================================
echo  BlockMesh - SAFE TEST (no real block sent)
echo  validate + plan + simulate only
echo ==========================================
echo.

if not exist cookies.txt (
  echo [ERROR] cookies.txt not found in this folder.
  echo Fill in your account cookies in cookies.txt first.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0one-click-auto.ps1" -Mode safe -SpeedProfile balanced

echo.
echo Safe test finished. Check the reports\ and diagnostics\ folders for results.
pause
