@echo off
cd /d "%~dp0\.."
set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"
call npm run dev
