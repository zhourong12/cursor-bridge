@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\console.ps1" pack
if errorlevel 1 (
  echo.
  echo [FAILED] see errors above
  pause
  exit /b 1
)
echo.
echo [OK] release\BridgeConsole-0.1.0-portable.exe
echo [OK] release\win-unpacked\Bridge Console.exe
pause
