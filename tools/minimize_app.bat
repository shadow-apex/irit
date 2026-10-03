@echo off
set "PROCNAME=%~1"
if "%PROCNAME%"=="" (
    echo Vui long cung cap ten ung dung.
    exit /b 1
)

echo Dang thu nho ung dung %PROCNAME%...
powershell -ExecutionPolicy Bypass -File "%~dp0minimize.ps1" "%PROCNAME%"

if %errorlevel%==0 (
    echo Thu nho thanh cong!
) else (
    echo Khong tim thay cua so hoac ung dung chua mo.
)
exit /b %errorlevel%
