@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Dodobox needs Node.js 24 or newer: https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules call npm install --omit=dev
set OPEN=1
node server.js
pause
