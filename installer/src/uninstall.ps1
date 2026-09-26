param([switch]$Quiet,[switch]$Elevated,[switch]$RemoveData)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'filesystemAdapter.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'registryDetector.psm1') -Force
Add-Type -AssemblyName System.Windows.Forms

function Resolve-UninstallTarget {
  param([object]$State,[object]$Persisted)
  if($Persisted -and $Persisted.InstallPath){$match=$State.CompatLocations|Where-Object{[IO.Path]::GetFullPath($_.Path).TrimEnd('\') -eq [IO.Path]::GetFullPath($Persisted.InstallPath).TrimEnd('\')}|Select-Object -First 1;if($match){return $match}}
  if($State.CompatLocations.Count -eq 1){return $State.CompatLocations[0]}
  if($State.CompatLocations.Count -gt 1){throw '检测到多个安装位置，但没有可确认的持久化 InstallLocation。请从安装器主界面确认位置。'}
  return $null
}

try {
  $roots=@(Detect-CepRoots);$state=Get-CepInstallState $roots;$persisted=Get-PersistedInstallLocation;$target=Resolve-UninstallTarget $state $persisted
  if(-not $target){Clear-PersistedInstallLocation;Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PSAIImageHubCompat' -Recurse -Force -ErrorAction SilentlyContinue;if(-not $Quiet){[Windows.Forms.MessageBox]::Show('未检测到已安装的 Runtime；已清理卸载记录。','卸载完成','OK','Information')|Out-Null};exit 0}
  $removeDataChoice=$RemoveData.IsPresent
  if(-not $Quiet){$confirm=[Windows.Forms.MessageBox]::Show("将卸载以下 PS AI Image Hub Runtime：`r`n$($target.Path)`r`n`r`n是否继续？",'卸载 PS AI Image Hub','YesNo','Question');if($confirm -ne 'Yes'){exit 0};$dataChoice=[Windows.Forms.MessageBox]::Show('是否同时删除本地用户数据？默认建议选择“否”。','可选数据清理','YesNo','Warning','Button2');$removeDataChoice=$dataChoice -eq 'Yes'}
  if($target.Root.RequiresAdmin -and -not(Test-IsAdministrator) -and -not $Elevated){$powerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe';$args="-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Quiet -Elevated";if($removeDataChoice){$args+=' -RemoveData'};try{$process=Start-Process -FilePath $powerShell -Verb RunAs -ArgumentList $args -Wait -PassThru;if($process.ExitCode -ne 0){throw "Elevated uninstaller exited with code $($process.ExitCode)."};exit 0}catch{[Windows.Forms.MessageBox]::Show('未获得管理员权限，无法删除所记录的 System CEP Compat 目录。安装位置不会自动改为 User CEP Root。','卸载需要管理员权限','OK','Warning')|Out-Null;exit 1}}
  Uninstall-CompatRuntime -TargetPath $target.Path -RemoveData:$removeDataChoice -Roots $roots
  Clear-PersistedInstallLocation
  Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PSAIImageHubCompat' -Recurse -Force -ErrorAction SilentlyContinue
  if(-not $Quiet){[Windows.Forms.MessageBox]::Show("PS AI Image Hub 已卸载。`r`n`r`n已删除：$($target.Path)`r`n用户数据按所选选项处理。",'卸载完成','OK','Information')|Out-Null}
} catch {
  if(-not $Quiet){[Windows.Forms.MessageBox]::Show("PS AI Image Hub 卸载失败。`r`n`r`n错误摘要：$($_.Exception.Message)",'卸载失败','OK','Error')|Out-Null}else{Write-Error $_}
  exit 1
}
