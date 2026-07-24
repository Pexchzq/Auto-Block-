@echo off
setlocal
cd /d "%~dp0"
if not exist ".env" (
  echo Missing discord-bot\.env
  echo Copy .env.example to .env and fill in the required values.
  pause
  exit /b 1
)
node src\index.mjs
if errorlevel 1 pause
