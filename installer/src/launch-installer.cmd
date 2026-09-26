@echo off
setlocal
set "INSTALLER_SCRIPT=%~dp0install.ps1"

if not exist "%INSTALLER_SCRIPT%" (
  set "BOOTSTRAP_LOG=%TEMP%\PSAIImageHubCompatInstaller-bootstrap-error.log"
  >>"%BOOTSTRAP_LOG%" echo [%date% %time%] install.ps1 is missing from "%~dp0"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('PS AI Image Hub 安装器启动失败：缺少 install.ps1。','安装器启动失败','OK','Error') ^| Out-Null"
  if /I "%PSAIHUB_INSTALLER_DEBUG%"=="1" pause
  exit /b 2
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER_SCRIPT%"
set "INSTALLER_EXIT=%ERRORLEVEL%"
if /I "%PSAIHUB_INSTALLER_DEBUG%"=="1" (
  echo.
  echo Installer exit code: %INSTALLER_EXIT%
  pause
)
exit /b %INSTALLER_EXIT%
