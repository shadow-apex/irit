@echo off
cd /d "%~dp0\.."
set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"
if not exist "dist\index.html" (
  call npm run build
)
node scripts/run-electron.mjs --prod
