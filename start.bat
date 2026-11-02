@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Dodobox needs Node.js 24 or newer: https://nodejs.org
  pause
  exit /b 1
)
rem npm writes node_modules\.package-lock.json after a finished install, so a missing or older one means the install is partial or out of date.
set NEED=
if not exist node_modules\.package-lock.json set NEED=1
if not defined NEED for /f %%i in ('powershell -NoProfile -Command "if ((Get-Item package-lock.json).LastWriteTime -gt (Get-Item node_modules\.package-lock.json).LastWriteTime) { 1 }"') do set NEED=1
if defined NEED (
  rem npm install, not npm ci: ci empties node_modules first, which would leave nothing to start with when offline.
  call npm install --omit=dev
  if not errorlevel 1 (
    rem npm leaves the marker alone when nothing changed, and it must not stay older than the lock file.
    copy /b node_modules\.package-lock.json +,, >nul
  ) else (
    rem Offline: carry on when what is installed is already enough to start.
    if not exist node_modules\.package-lock.json (
      echo Could not install the dependencies.
      pause
      exit /b 1
    )
    echo Could not update the dependencies; starting with the ones already installed.
  )
)
set OPEN=1
node server.js
pause
