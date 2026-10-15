@echo off
rem Turns on automatic updates for this copy of Friend Sweep Lite.
rem
rem It creates one Windows scheduled task (for your own user account) that runs
rem auto-update.ps1 from this folder every 30 minutes, starts it once through the Task
rem Scheduler, and checks that it really ran. "Disable auto-update.bat" removes the task.
rem
rem Windows' own programs are called by their full path, never by name from this folder.
setlocal
set "FOLDER=%~dp0"
set "TASK=OviPets Friend Sweep Lite update"
set "SYS=%SystemRoot%\System32"
set "PS=%SYS%\WindowsPowerShell\v1.0\powershell.exe"
set "SCHTASKS=%SYS%\schtasks.exe"
set "BEAT=%FOLDER%auto-update-last-check.txt"
rem First choice: no window at all. Second: the standard way, a window may flash for a moment.
set "QUIET=%SYS%\conhost.exe --headless %PS% -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"%FOLDER%auto-update.ps1\""
set "PLAIN=%PS% -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"%FOLDER%auto-update.ps1\""

if not exist "%FOLDER%manifest.json" goto wrongfolder

echo Turning on automatic updates for:
echo   %FOLDER%
echo.
set "ACTION=%QUIET%"
call :install
if errorlevel 2 goto nocreate
if not errorlevel 1 goto done
echo The windowless launcher did not run on this PC - using the standard one instead.
set "ACTION=%PLAIN%"
call :install
if errorlevel 2 goto nocreate
if errorlevel 1 goto norun

:done
echo Automatic updates are ON. Every 30 minutes this folder is compared with GitHub;
echo a newer version is copied in, and the extension reloads itself when no sweep is
echo running or between two passes.
echo.
echo Last check:
type "%BEAT%"
echo.
pause
exit /b 0

:wrongfolder
echo This file must stay inside the Friend Sweep Lite folder, next to manifest.json.
pause
exit /b 1

:nocreate
echo Windows refused to create the scheduled task. Automatic updates are OFF.
pause
exit /b 1

:norun
echo The scheduled task was created but did not run within a minute.
echo Automatic updates may not work on this PC; "Disable auto-update.bat" removes the task.
pause
exit /b 1

rem Creates the task with %ACTION%, starts it through the Task Scheduler and waits for the
rem updater's own mark. Returns 0 = it ran, 1 = it did not run, 2 = the task was not created.
:install
if exist "%BEAT%" del "%BEAT%"
call "%SCHTASKS%" /Create /F /TN "%TASK%" /SC MINUTE /MO 30 /TR "%ACTION%" >nul
if errorlevel 1 exit /b 2
call "%SCHTASKS%" /Run /TN "%TASK%" >nul
set /a WAITED=0
:wait
if exist "%BEAT%" exit /b 0
"%SYS%\PING.EXE" -n 3 127.0.0.1 >nul
set /a WAITED+=2
if %WAITED% lss 60 goto wait
exit /b 1
