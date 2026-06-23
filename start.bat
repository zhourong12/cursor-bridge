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
echo [Lark Bridge] npm run lark-bridge:cursor
echo.
call npm run lark-bridge:cursor
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%
