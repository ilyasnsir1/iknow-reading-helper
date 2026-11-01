@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-word-voice.ps1"
set "voice_exit=%errorlevel%"
if not "%voice_exit%"=="0" (
  echo.
  echo Word voice setup did not finish. The message above explains why.
)
echo.
pause
exit /b %voice_exit%
