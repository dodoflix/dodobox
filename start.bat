@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Dodobox needs Node.js 24 or newer: https://nodejs.org
  pause
  exit /b 1
)
rem node_modules\.dodobox-lock is the package-lock.json of the last finished install; comparing contents (not times) also catches a downgrade or an archive with old file times.
rem npm writes node_modules\.package-lock.json after a finished install, so a missing one means the install is partial.
set NEED=
if not exist node_modules\.package-lock.json set NEED=1
if not defined NEED (
  fc /b package-lock.json node_modules\.dodobox-lock >nul 2>nul
  if errorlevel 1 set NEED=1
)
if defined NEED (
  rem npm install, not npm ci: ci empties node_modules first, which would leave nothing to start with when offline.
  call npm install --omit=dev
  if not errorlevel 1 (
    copy /y package-lock.json node_modules\.dodobox-lock >nul
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
