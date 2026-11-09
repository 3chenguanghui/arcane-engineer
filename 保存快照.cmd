@echo off
chcp 65001 >nul
setlocal
set "PS1=%~dp0snapshot.ps1"
if not exist "%PS1%" (
  echo [ERROR] snapshot.ps1 not found next to this file.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
echo.
pause
