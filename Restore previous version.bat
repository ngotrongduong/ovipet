@echo off
rem Restore the immediately previous version (Edge and Chrome must be closed).
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0auto-update.ps1" -Rollback
echo.
if exist "%~dp0auto-update-last-check.txt" type "%~dp0auto-update-last-check.txt"
pause
