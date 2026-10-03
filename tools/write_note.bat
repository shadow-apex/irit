@echo off
rem ------------------------------------------------------------
rem write_note.bat - Ghi noi dung vao file roi mo bang Notepad
rem ------------------------------------------------------------

:: Kiem tra neu khong co noi dung
if "%~1"=="" (
    echo Vui long cung cap noi dung can ghi.
    exit /b 1
)

:: Tao mot file tam thoi (temporary file)
set "TEMP_FILE=%TEMP%\iris_quick_note.txt"

:: Ghi noi dung (tham so truyen vao) vao file tam thoi
echo %~1 > "%TEMP_FILE%"

:: Mo file vua ghi bang Notepad
start notepad.exe "%TEMP_FILE%"

echo Da ghi chu vao Notepad thanh cong!
exit /b 0
