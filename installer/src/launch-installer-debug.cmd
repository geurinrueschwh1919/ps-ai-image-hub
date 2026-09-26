@echo off
setlocal
set "PSAIHUB_INSTALLER_DEBUG=1"
call "%~dp0launch-installer.cmd"
exit /b %ERRORLEVEL%
