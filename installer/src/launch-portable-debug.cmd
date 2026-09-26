@echo off
setlocal
set "INSTALLER_DIR=%~dp0..\Installer"
set "INSTALLER_SCRIPT=%INSTALLER_DIR%\install.ps1"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

echo PS AI Image Hub installer diagnostics
echo Installer directory: "%INSTALLER_DIR%"
echo.

if not exist "%INSTALLER_SCRIPT%" (
  echo ERROR: install.ps1 is missing.
  echo Extract the entire ZIP before running this file.
  echo.
  pause
  exit /b 2
)

if not exist "%POWERSHELL_EXE%" (
  echo ERROR: Windows PowerShell is unavailable.
  echo.
  pause
  exit /b 3
)

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER_SCRIPT%"
set "INSTALLER_EXIT=%ERRORLEVEL%"
echo.
echo Installer exit code: %INSTALLER_EXIT%
echo Diagnostic logs are under:
echo   %%LOCALAPPDATA%%\PSAIImageHubCompatInstaller\logs
echo   %%TEMP%%\PSAIImageHubCompatInstaller\logs
echo.
pause
exit /b %INSTALLER_EXIT%
