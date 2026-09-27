Option Explicit

Dim fileSystem, shell, scriptDirectory, installerDirectory
Dim installerScript, powershellExecutable, actionArguments
Dim commandLine, exitCode, processEnvironment

Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
Set processEnvironment = shell.Environment("PROCESS")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
installerDirectory = fileSystem.BuildPath(scriptDirectory, "Installer")
installerScript = fileSystem.BuildPath(installerDirectory, "install.ps1")
powershellExecutable = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
actionArguments = ""

If processEnvironment("PSAIHUB_INSTALLER_VALIDATE_ONLY") = "1" Then
  actionArguments = " -Action ValidateStartup"
End If

If Not fileSystem.FileExists(installerScript) Then
  MsgBox "PS AI Image Hub 安装文件不完整。" & vbCrLf & vbCrLf & _
    "缺少：" & installerScript & vbCrLf & _
    "请先完整解压 ZIP，再运行安装程序。", _
    vbCritical, "PS AI Image Hub"
  WScript.Quit 2
End If

If Not fileSystem.FileExists(powershellExecutable) Then
  MsgBox "当前系统找不到 Windows PowerShell。" & vbCrLf & vbCrLf & _
    "请使用 Manual 文件夹中的手动安装方式。", _
    vbCritical, "PS AI Image Hub"
  WScript.Quit 3
End If

commandLine = QuoteArgument(powershellExecutable) & _
  " -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & _
  QuoteArgument(installerScript) & actionArguments

' Window style 0 keeps the launcher and PowerShell console hidden. The installer
' itself continues to display its existing Windows UI.
exitCode = shell.Run(commandLine, 0, True)

If exitCode <> 0 Then
  MsgBox "PS AI Image Hub 安装程序退出，错误代码：" & exitCode & vbCrLf & vbCrLf & _
    "请运行 Debug\PSAIHub-Debug.cmd 查看详细信息。" & vbCrLf & _
    "日志位置：%LOCALAPPDATA%\PSAIImageHubCompatInstaller\logs", _
    vbCritical, "PS AI Image Hub"
End If

WScript.Quit exitCode

Function QuoteArgument(ByVal value)
  QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
