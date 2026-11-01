@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
set "uninstall_exit=%errorlevel%"
echo.
pause
exit /b %uninstall_exit%
