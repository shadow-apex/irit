@echo off
rem ------------------------------------------------------------
rem close_iris.bat - Forcefully close an application
rem ------------------------------------------------------------

set "PROCNAME=%~1"
if "%PROCNAME%"=="" set "PROCNAME=iris.exe"

echo Dang dong ung dung %PROCNAME%...
taskkill /IM "%PROCNAME%" /F

if %errorlevel%==0 (
    echo Dong thanh cong!
) else (
    echo Khong the dong hoac ung dung khong hoat dong.
)
exit /b %errorlevel%
