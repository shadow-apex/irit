@echo off
title Iris AI Assistant
echo ========================================================
echo   Iris AI Assistant dang chay...
echo   (Dong cua so nay se tat Iris)
echo ========================================================
cd /d "%~dp0\.."
set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"
if not exist "dist\index.html" (
  echo Dang build giao dien Iris lan dau...
  call npm run build
)
node scripts/run-electron.mjs --prod
