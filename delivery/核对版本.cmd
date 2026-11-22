@echo off
chcp 65001 >nul
title Version Check - Arcane Engineer
rem ============================================================
rem  Double-click launcher. All logic lives in check_version.ps1.
rem  This file is intentionally ASCII-only so it never garbles.
rem  After a rebuild, edit the three expected values in
rem  check_version.ps1 only.
rem ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check_version.ps1"
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
