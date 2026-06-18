@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  echo Missing .env. Copy .env.example to .env and edit it first.
  pause
  exit /b 1
)

node src\server.js
pause
