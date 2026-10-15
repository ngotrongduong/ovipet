@echo off
rem Install a user-level Windows scheduled task for this unpacked Full extension.
rem Put this file, auto-update.ps1 and the other launchers next to manifest.json.
setlocal
set "FOLDER=%~dp0"
set "TASK=OviPets Full Extension update"
set "SYS=%SystemRoot%\System32"
set "PS=%SYS%\WindowsPowerShell\v1.0\powershell.exe"
set "SCHTASKS=%SYS%\schtasks.exe"
if not exist "%FOLDER%manifest.json" goto missing
if not exist "%FOLDER%auto-update.ps1" goto missing
echo Enabling safe GitHub main updates for:
echo   %FOLDER%
echo.
echo A newer green-CI version is staged, then installed when Edge and Chrome
echo are fully closed. Closing Edge also closes running game jobs, so do so
echo only after you have finished your work.
echo.
set "ACTION=%PS% -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%FOLDER%auto-update.ps1\""
call "%SCHTASKS%" /Create /F /TN "%TASK%" /SC MINUTE /MO 30 /TR "%ACTION%"
if errorlevel 1 goto failed
call "%SCHTASKS%" /Run /TN "%TASK%"
echo.
echo Auto-update task is installed and scheduled every 30 minutes.
echo Read auto-update-last-check.txt to see the result; use Update now.bat
echo while Edge is closed if you want to check immediately.
pause
exit /b 0
:missing
echo Missing manifest.json or auto-update.ps1 next to this launcher.
echo Extract the updater KIT into the SAME folder Edge loads unpacked.
pause
exit /b 1
:failed
echo Task Scheduler refused to install the task. Nothing was enabled.
pause
exit /b 1
