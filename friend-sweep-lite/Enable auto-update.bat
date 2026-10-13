@echo off
rem Turns on automatic updates for this copy of Friend Sweep Lite.
rem It creates one Windows scheduled task (for your own user account) that runs
rem auto-update.ps1 from this folder every 30 minutes. "Disable auto-update.bat" removes it.
rem Windows' own programs are called by their full path, never by name from this folder.
setlocal
set "FOLDER=%~dp0"
set "TASK=OviPets Friend Sweep Lite update"
set "SYS=%SystemRoot%\System32"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

if not exist "%FOLDER%manifest.json" (
  echo This file must stay inside the Friend Sweep Lite folder, next to manifest.json.
  pause
  exit /b 1
)

"%SYS%\schtasks.exe" /Create /F /TN "%TASK%" /SC MINUTE /MO 30 /TR "%SYS%\conhost.exe --headless %PS% -NoProfile -ExecutionPolicy Bypass -File \"%FOLDER%auto-update.ps1\"" >nul
if errorlevel 1 (
  echo Could not create the scheduled task.
  pause
  exit /b 1
)

echo Automatic updates are ON for:
echo   %FOLDER%
echo Every 30 minutes this folder is compared with GitHub; a newer version is copied in,
echo and the extension reloads itself when no sweep is running or between two passes.
echo.
echo Checking once now...
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%FOLDER%auto-update.ps1"
if exist "%FOLDER%auto-update.log" (
  echo Last lines of auto-update.log:
  "%PS%" -NoProfile -Command "Get-Content -LiteralPath '%FOLDER%auto-update.log' -Tail 3"
) else (
  echo Already up to date.
)
echo.
pause
