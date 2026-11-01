@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
set "setup_exit=%errorlevel%"
if not "%setup_exit%"=="0" (
  echo.
  echo Setup did not finish. The message above explains why.
)
echo.
echo Press any key to close this window . . .
pause >nul
exit /b %setup_exit%
