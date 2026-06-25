@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found. Install Node.js or add npm to PATH.
  pause
  exit /b 1
)

echo.
echo [Bridge Console Web] npm run console:web:build
echo.
call npm run console:web:build %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [Bridge Console Web] Failed, exit code %RC%
  pause
)
exit /b %RC%
