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
echo [Lark Bridge] npm run lark-bridge:restart
echo.
call npm run lark-bridge:restart
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [Lark Bridge] Failed, exit code %RC%
  pause
)
exit /b %RC%
