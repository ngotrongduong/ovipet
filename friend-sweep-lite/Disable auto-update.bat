@echo off
rem Turns automatic updates for Friend Sweep Lite off again: removes the scheduled task that
rem "Enable auto-update.bat" created. Nothing in this folder is changed.
"%SystemRoot%\System32\schtasks.exe" /Delete /F /TN "OviPets Friend Sweep Lite update" >nul 2>&1
if errorlevel 1 (
  echo No update task was found - automatic updates were already off.
) else (
  echo Automatic updates are OFF. The extension stays at its current version.
)
pause
