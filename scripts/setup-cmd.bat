@echo off
setlocal
pushd "%~dp0\.."
set "PROJECT_ROOT=%CD%"
popd

set "TARGET_DIR=%LOCALAPPDATA%\Microsoft\WindowsApps"
set "CMD_FILE=%TARGET_DIR%\iris.cmd"

if not exist "%TARGET_DIR%" (
  mkdir "%TARGET_DIR%"
)

(
  echo @echo off
  echo cd /d "%PROJECT_ROOT%"
  echo npm run dev %%*
) > "%CMD_FILE%"

echo ========================================================
echo   Da cai dat lenh 'iris' thanh cong cho laptop nay!
echo   Duong dan project: %PROJECT_ROOT%
echo   Bay gio ban co the mo CMD o bat cu dau va go: iris
echo ========================================================
pause
