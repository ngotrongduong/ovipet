@echo off
rem Immediately check for a green main release. Copy is blocked while browsers run.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0auto-update.ps1"
echo.
if exist "%~dp0auto-update-last-check.txt" type "%~dp0auto-update-last-check.txt"
pause
