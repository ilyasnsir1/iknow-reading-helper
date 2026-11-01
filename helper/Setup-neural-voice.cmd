@echo off
call "%~dp0Setup.cmd" -Mode Voices %*
exit /b %errorlevel%
