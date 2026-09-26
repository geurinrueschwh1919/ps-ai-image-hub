@echo off
setlocal
set "INSTALLER_DIR=%~dp0Installer"
set "INSTALLER_SCRIPT=%INSTALLER_DIR%\install.ps1"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "INSTALLER_ACTION_ARGS="
if /I "%PSAIHUB_INSTALLER_VALIDATE_ONLY%"=="1" set "INSTALLER_ACTION_ARGS=-Action ValidateStartup"

if not exist "%INSTALLER_SCRIPT%" (
  echo PS AI Image Hub installer files are incomplete.
  echo Missing: "%INSTALLER_SCRIPT%"
  echo Please extract the entire ZIP before running this file.
  echo.
  pause
  exit /b 2
)

if not exist "%POWERSHELL_EXE%" (
  echo Windows PowerShell is unavailable: "%POWERSHELL_EXE%"
  echo Use the Manual folder and follow README-install.txt.
  echo.
  pause
  exit /b 3
)

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER_SCRIPT%" %INSTALLER_ACTION_ARGS%
set "INSTALLER_EXIT=%ERRORLEVEL%"
if not "%INSTALLER_EXIT%"=="0" (
  echo.
  echo PS AI Image Hub installer exited with code %INSTALLER_EXIT%.
  echo The window will remain open so this error can be reported.
  echo.
  pause
)
exit /b %INSTALLER_EXIT%
