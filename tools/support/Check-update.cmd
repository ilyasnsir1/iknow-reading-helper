@echo off
setlocal
set "reader_python=%LOCALAPPDATA%\iKnowLesehilfe\runtime\python\python.exe"
if not exist "%reader_python%" (
  echo The existing Reading Helper Python runtime was not found.
  echo This check does not install or change anything.
  echo Please share this message with the project maintainer.
  echo.
  pause
  exit /b 1
)
"%reader_python%" -B "%~dp0check_update.py" %*
set "reader_result=%errorlevel%"
echo.
echo Press any key to close this window . . .
pause >nul
exit /b %reader_result%
