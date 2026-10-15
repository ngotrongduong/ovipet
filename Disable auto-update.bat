@echo off
rem Unregister the scheduled task; do not delete the extension or backup.
"%SystemRoot%\System32\schtasks.exe" /Delete /F /TN "OviPets Full Extension update"
if errorlevel 1 (
  echo Update task was not found or could not be removed.
) else (
  echo Full Extension GitHub auto-updates are disabled.
)
pause
