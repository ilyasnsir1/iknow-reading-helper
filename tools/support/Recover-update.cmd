@echo off
setlocal
set "reader_cache=%LOCALAPPDATA%\iKnowLesehilfe"
if defined IKNOW_READER_CACHE set "reader_cache=%IKNOW_READER_CACHE%"
set "reader_python=%reader_cache%\runtime\python\python.exe"
if not exist "%reader_python%" (
  echo The existing Reading Helper Python runtime was not found.
  echo Recovery has not changed the installed application or learning data.
  echo Please share this message with the project maintainer.
  echo.
  pause
  exit /b 1
)
"%reader_python%" -B "%~dp0recover_update.py" --apply %*
set "reader_result=%errorlevel%"
echo.
echo Press any key to close this window . . .
pause >nul
exit /b %reader_result%
