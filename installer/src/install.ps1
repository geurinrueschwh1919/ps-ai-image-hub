param(
  [ValidateSet('UI','Install','Repair','Uninstall','ValidateStartup','ElevatedInstall')][string]$Action='UI',
  [string]$SelectedRootToken,
  [switch]$EnableDebugMode
)
$ErrorActionPreference = 'Stop'
$script:LogFile = $null

function Initialize-InstallerLog {
  if ($script:LogFile) { return }
  $roots=@();if($env:LOCALAPPDATA){$roots+=Join-Path $env:LOCALAPPDATA 'PSAIImageHubCompatInstaller\logs'};if($env:TEMP){$roots+=Join-Path $env:TEMP 'PSAIImageHubCompatInstaller\logs'}
  foreach($root in $roots|Select-Object -Unique){try{New-Item -ItemType Directory -Path $root -Force -ErrorAction Stop|Out-Null;$candidate=Join-Path $root ((Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'.log');Add-Content -LiteralPath $candidate -Value ("{0:o} installer bootstrap" -f (Get-Date)) -Encoding UTF8 -ErrorAction Stop;$script:LogFile=$candidate;return}catch{}}
}
function Write-SafeLog([string]$Message){try{if(-not $script:LogFile){Initialize-InstallerLog};if($script:LogFile){Add-Content -LiteralPath $script:LogFile -Value ("{0:o} {1}" -f (Get-Date),$Message) -Encoding UTF8 -ErrorAction Stop}}catch{}}
function Show-InstallerStartupError { param([Management.Automation.ErrorRecord]$ErrorRecord);$summary=if($ErrorRecord.Exception.Message){$ErrorRecord.Exception.Message}else{'未知错误'};$details="startup failed type={0} message={1} position={2} stack={3}" -f $ErrorRecord.Exception.GetType().FullName,$summary,$ErrorRecord.InvocationInfo.PositionMessage,$ErrorRecord.ScriptStackTrace;Write-SafeLog $details;$logHint=if($script:LogFile){$script:LogFile}else{'日志目录不可写'};$message="PS AI Image Hub 安装器启动失败`r`n`r`n错误摘要：$summary`r`n`r`n错误日志：$logHint";try{Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop;[Windows.Forms.MessageBox]::Show($message,'安装器启动失败','OK','Error')|Out-Null}catch{try{(New-Object -ComObject WScript.Shell).Popup($message,0,'安装器启动失败',16)|Out-Null}catch{Write-Error $message}} }
function ConvertTo-RootToken([string]$Root){return [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Root))}
function ConvertFrom-RootToken([string]$Token){if(-not $Token){throw 'Missing selected CEP root token.'};return [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Token))}

try {
  Initialize-InstallerLog
  Import-Module (Join-Path $PSScriptRoot 'registryDetector.psm1') -Force
  Import-Module (Join-Path $PSScriptRoot 'filesystemAdapter.psm1') -Force
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $metadata=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'metadata.json') -Raw -Encoding UTF8|ConvertFrom-Json
  $hashes=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime-hashes.json') -Raw -Encoding UTF8|ConvertFrom-Json

  function Get-ProcessState { return @(Get-Process -Name Photoshop -ErrorAction SilentlyContinue).Count -gt 0 }
  function Format-PhotoshopDetection($items){if(-not $items -or $items.Count -eq 0){return "未检测到 Photoshop。仍可安装，但目标范围仅为 23.x–25.x。"};$text=(($items|ForEach-Object{"[{0}] {1}  Version: {2}  Status: {3}`r`n{4}" -f $(if($_.Status -eq 'Supported'){'✓'}else{'!'}),$_.Name,$_.Version,$_.Status,$_.Path}) -join "`r`n");if(-not($items|Where-Object{$_.Status -eq 'Supported'})){$text+="`r`n未检测到 Photoshop 23.x–25.x；当前版本不属于已计划兼容范围。"};return $text}
  function Find-RootRecord([object[]]$Roots,[string]$Path){return $Roots|Where-Object{[IO.Path]::GetFullPath($_.Path).TrimEnd('\') -eq [IO.Path]::GetFullPath($Path).TrimEnd('\')}|Select-Object -First 1}

  function Register-Uninstaller([string]$InstallRoot,[string]$InstallPath){
    $cache=Join-Path $env:LOCALAPPDATA 'PSAIImageHubCompatInstaller';New-Item -ItemType Directory -Path $cache -Force|Out-Null
    foreach($name in @('uninstall.ps1','filesystemAdapter.psm1','registryDetector.psm1')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $cache $name) -Force}
    Set-PersistedInstallLocation -InstallRoot $InstallRoot -InstallPath $InstallPath -InstalledVersion $metadata.bundleVersion
    $key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PSAIImageHubCompat';New-Item -Path $key -Force|Out-Null
    $uninstall='powershell.exe -NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $cache 'uninstall.ps1')+'"'
    Set-ItemProperty -Path $key -Name DisplayName -Value $metadata.displayName;Set-ItemProperty -Path $key -Name DisplayVersion -Value $metadata.bundleVersion;Set-ItemProperty -Path $key -Name Publisher -Value 'PS AI Image Hub';Set-ItemProperty -Path $key -Name InstallLocation -Value $InstallPath;Set-ItemProperty -Path $key -Name UninstallString -Value $uninstall;New-ItemProperty -Path $key -Name NoModify -Value 1 -PropertyType DWord -Force|Out-Null
  }

  function Select-UserRootInUi { if($script:RootOptions -and $script:RootCombo){for($i=0;$i -lt $script:RootOptions.Count;$i++){if($script:RootOptions[$i].Root.Type -eq 'user'){$script:RootCombo.SelectedIndex=$i;break}}} }
  function Invoke-ElevatedInstall([string]$TargetRoot,[bool]$DebugMode){
    $token=ConvertTo-RootToken $TargetRoot;$powerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe';$args="-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Action ElevatedInstall -SelectedRootToken `"$token`"";if($DebugMode){$args+=' -EnableDebugMode'}
    try{$process=Start-Process -FilePath $powerShell -Verb RunAs -ArgumentList $args -Wait -PassThru;if($process.ExitCode -ne 0){Write-SafeLog "elevated install failed exit=$($process.ExitCode) root=$TargetRoot";return $false};return $true}
    catch{Write-SafeLog ("uac denied root={0} error={1}" -f $TargetRoot,$_.Exception.GetType().Name);$choice=[Windows.Forms.MessageBox]::Show('未获得管理员权限，无法写入所选 System CEP 目录。`r`n`r`n选择“是”改用 User CEP Root；选择“否”返回重新选择；选择“取消”取消操作。','需要管理员权限','YesNoCancel','Warning');if($choice -eq 'Yes'){Select-UserRootInUi};return $false}
  }

  function Invoke-Install([string]$TargetRoot,[bool]$DebugMode,[switch]$ElevatedChild){
    $roots=@(Detect-CepRoots);$rootRecord=Find-RootRecord $roots $TargetRoot;if(-not $rootRecord){throw 'Selected CEP root is not a known root.'}
    Write-SafeLog ("selected cep root={0} type={1} adminRequired={2}" -f $rootRecord.Path,$rootRecord.Type,$rootRecord.RequiresAdmin)
    if($rootRecord.RequiresAdmin -and -not(Test-IsAdministrator) -and -not $ElevatedChild){$choice=[Windows.Forms.MessageBox]::Show("目标 CEP 目录需要管理员权限：`r`n$($rootRecord.Path)`r`n`r`n选择【是】以管理员权限继续；选择【否】改选 User CEP Root；选择【取消】取消。",'需要管理员权限','YesNoCancel','Question');if($choice -eq 'Yes'){return Invoke-ElevatedInstall -TargetRoot $rootRecord.Path -DebugMode:$DebugMode};if($choice -eq 'No'){Select-UserRootInUi};return $false}
    if(Get-ProcessState){$choice=[Windows.Forms.MessageBox]::Show('检测到 Photoshop 正在运行。建议关闭所有 Photoshop 实例后继续。是否仍继续？','Photoshop 正在运行','YesNo','Warning');if($choice -ne 'Yes'){return $false}}
    $payload=Join-Path $env:TEMP ('PSAIImageHubCompatPayload-'+[guid]::NewGuid().ToString('N'))
    try{Expand-Archive -LiteralPath (Join-Path $PSScriptRoot 'payload.zip') -DestinationPath $payload -Force;$result=Install-CompatTransactional -PayloadRoot $payload -Hashes $hashes -TargetRoot $rootRecord.Path -Roots $roots;if($DebugMode){Enable-DetectedCSXSDebugMode -Statuses (Get-CSXSStatus) -ExplicitlyApproved|Out-Null};Register-Uninstaller -InstallRoot $result.Root -InstallPath $result.Path;Write-SafeLog ("install success version={0} root={1} path={2} hash=pass rollback=false" -f $metadata.bundleVersion,$result.Root,$result.Path);$detectedNames=@((Get-PhotoshopDetections)|ForEach-Object{"$($_.Name)（$($_.Version)）"});$detectedText=if($detectedNames.Count){$detectedNames -join '、'}else{'未检测到 Photoshop'};[Windows.Forms.MessageBox]::Show("PS AI Image Hub 已安装。`r`n`r`n实际安装位置：$($result.Path)`r`n检测到：$detectedText`r`n`r`nPhotoshop → 窗口 → 扩展（旧版）→ PS AI Image Hub`r`n`r`n首次使用真实 API 需要重新填写 API Key。",'安装完成','OK','Information')|Out-Null;return $true}
    catch{Write-SafeLog ("install failed root={0} rollback=attempted error={1} message={2}" -f $rootRecord.Path,$_.Exception.GetType().Name,$_.Exception.Message);[Windows.Forms.MessageBox]::Show("安装失败；如存在旧安装，已尝试自动回滚。`r`n`r`n错误摘要：$($_.Exception.Message)",'安装失败','OK','Error')|Out-Null;return $false}
    finally{if(Test-Path -LiteralPath $payload){Remove-Item -LiteralPath $payload -Recurse -Force}}
  }

  function Resolve-ActionRoot { $roots=@(Detect-CepRoots);$state=Get-CepInstallState $roots;$recommendation=Select-RecommendedCepRoot $roots $state;$persisted=Get-PersistedInstallLocation;$primary=Get-PrimaryCompatLocation $state $recommendation $persisted;if($primary){return $primary.RootPath};return $recommendation.Root.Path }

  if($Action -eq 'Uninstall'){& (Join-Path $PSScriptRoot 'uninstall.ps1');exit}
  if($Action -eq 'ValidateStartup'){Write-Output "PASS: installer startup resources loaded from $PSScriptRoot";exit 0}
  if($Action -eq 'ElevatedInstall'){$root=ConvertFrom-RootToken $SelectedRootToken;if(Invoke-Install -TargetRoot $root -DebugMode:$EnableDebugMode.IsPresent -ElevatedChild){exit 0}else{exit 1}}
  if($Action -in @('Install','Repair')){$root=Resolve-ActionRoot;if(Invoke-Install -TargetRoot $root -DebugMode:$false){exit 0}else{exit 1}}

  $form=New-Object Windows.Forms.Form;$form.Text='PS AI Image Hub 安装器';$form.Size=New-Object Drawing.Size(900,780);$form.StartPosition='CenterScreen';$form.Font=New-Object Drawing.Font('Microsoft YaHei UI',9)
  $title=New-Object Windows.Forms.Label;$title.Text="$($metadata.displayName)  Version: $($metadata.versionLabel) / $($metadata.bundleVersion)    Host Range: $($metadata.hostRange)";$title.Location=New-Object Drawing.Point(20,15);$title.Size=New-Object Drawing.Size(840,30);$form.Controls.Add($title)
  $photoshopBox=New-Object Windows.Forms.TextBox;$photoshopBox.Multiline=$true;$photoshopBox.ReadOnly=$true;$photoshopBox.ScrollBars='Vertical';$photoshopBox.Location=New-Object Drawing.Point(20,50);$photoshopBox.Size=New-Object Drawing.Size(840,145);$form.Controls.Add($photoshopBox)
  $rootLabel=New-Object Windows.Forms.Label;$rootLabel.Text='CEP Root（默认选中推荐位置）：';$rootLabel.Location=New-Object Drawing.Point(20,207);$rootLabel.Size=New-Object Drawing.Size(300,25);$form.Controls.Add($rootLabel)
  $rootCombo=New-Object Windows.Forms.ComboBox;$rootCombo.DropDownStyle='DropDownList';$rootCombo.Location=New-Object Drawing.Point(20,232);$rootCombo.Size=New-Object Drawing.Size(840,30);$form.Controls.Add($rootCombo);$script:RootCombo=$rootCombo
  $reason=New-Object Windows.Forms.Label;$reason.Location=New-Object Drawing.Point(20,270);$reason.Size=New-Object Drawing.Size(840,55);$form.Controls.Add($reason)
  $status=New-Object Windows.Forms.TextBox;$status.Multiline=$true;$status.ReadOnly=$true;$status.ScrollBars='Vertical';$status.Location=New-Object Drawing.Point(20,330);$status.Size=New-Object Drawing.Size(840,270);$form.Controls.Add($status)
  $debug=New-Object Windows.Forms.CheckBox;$debug.Text='为检测到的 CEP 环境启用 PlayerDebugMode（仅 HKCU 已存在的 CSXS key）';$debug.Location=New-Object Drawing.Point(20,610);$debug.Size=New-Object Drawing.Size(790,28);$form.Controls.Add($debug)
  $installButton=New-Object Windows.Forms.Button;$installButton.Location=New-Object Drawing.Point(20,650);$installButton.Size=New-Object Drawing.Size(130,38);$form.Controls.Add($installButton)
  $uninstallButton=New-Object Windows.Forms.Button;$uninstallButton.Text='卸载';$uninstallButton.Location=New-Object Drawing.Point(165,650);$uninstallButton.Size=New-Object Drawing.Size(100,38);$form.Controls.Add($uninstallButton)
  $rescan=New-Object Windows.Forms.Button;$rescan.Text='重新扫描';$rescan.Location=New-Object Drawing.Point(280,650);$rescan.Size=New-Object Drawing.Size(110,38);$form.Controls.Add($rescan)
  $open=New-Object Windows.Forms.Button;$open.Text='查看安装位置';$open.Location=New-Object Drawing.Point(405,650);$open.Size=New-Object Drawing.Size(130,38);$form.Controls.Add($open)
  $guide=New-Object Windows.Forms.Button;$guide.Text='查看兼容说明';$guide.Location=New-Object Drawing.Point(550,650);$guide.Size=New-Object Drawing.Size(130,38);$form.Controls.Add($guide)

  function Update-SelectionUi { if(-not $script:SelectedRoot){return};$selectedCompat=$script:InstallState.CompatLocations|Where-Object{$_.RootPath -eq $script:SelectedRoot.Path}|Select-Object -First 1;$adminText=if($script:SelectedRoot.RequiresAdmin){'是（安装时使用标准 UAC）'}else{'否'};$reason.Text="推荐原因：$($script:Recommendation.Reason)`r`n当前选择：$($script:SelectedRoot.Path)    需要管理员权限：$adminText";$installButton.Text=if(-not $selectedCompat){'安装'}elseif($selectedCompat.Version -eq $metadata.bundleVersion){'修复安装'}else{'更新'} }
  function Refresh-UI {
    $previous=if($script:SelectedRoot){$script:SelectedRoot.Path}else{$null};$script:Refreshing=$true;$roots=@(Detect-CepRoots);$state=Get-CepInstallState $roots;$recommendation=Select-RecommendedCepRoot $roots $state;$persisted=Get-PersistedInstallLocation;$primary=Get-PrimaryCompatLocation $state $recommendation $persisted;$detected=@(Get-PhotoshopDetections);$csxs=@(Get-CSXSStatus)
    $script:Roots=$roots;$script:InstallState=$state;$script:Recommendation=$recommendation;$script:PrimaryCompat=$primary;$rootCombo.Items.Clear();$options=@()
    foreach($root in $roots){$formalHere=[bool]($state.FormalLocations|Where-Object{$_.RootPath -eq $root.Path});$compatHere=[bool]($state.CompatLocations|Where-Object{$_.RootPath -eq $root.Path});$isRecommended=$root.Path -eq $recommendation.Root.Path;$parts=@();if($isRecommended){$parts+='推荐'};$parts+=if($root.Exists){'目录存在'}else{'目录不存在'};$parts+=if($root.RequiresAdmin){'需要管理员权限'}else{'无需管理员权限'};if($formalHere){$parts+='检测到旧版安装'};if($compatHere){$parts+='检测到当前安装'};$display="[$($parts -join ' | ')] $($root.Path)";$option=[pscustomobject]@{Root=$root;Display=$display};$options+=$option;[void]$rootCombo.Items.Add($display)}
    $script:RootOptions=$options;$selectedPath=if($primary){$primary.RootPath}elseif($previous -and (Find-RootRecord $roots $previous)){$previous}else{$recommendation.Root.Path};for($i=0;$i -lt $options.Count;$i++){if($options[$i].Root.Path -eq $selectedPath){$rootCombo.SelectedIndex=$i;$script:SelectedRoot=$options[$i].Root;break}};$rootCombo.Enabled=-not $state.CompatInstalled
    $photoshopBox.Text=Format-PhotoshopDetection $detected
    $formalText=if($state.FormalLocations.Count){"旧版安装：已检测到`r`n"+(($state.FormalLocations|ForEach-Object{"- $($_.Path)  Version: $($_.Version)"}) -join "`r`n")}else{'旧版安装：未检测到'}
    $compatText=if($state.CompatLocations.Count){"当前安装：已检测到`r`n"+(($state.CompatLocations|ForEach-Object{"- $($_.Path)  Version: $($_.Version)  Identity: $(if($_.IdentityValid){'Valid'}else{'Invalid'})"}) -join "`r`n")}else{'当前安装：未检测到'}
    if($state.DuplicateCompat){$compatText+="`r`n警告：检测到多个安装位置。不会自动删除任何副本，请仅保留实际使用的位置。"}
    $rootText="推荐 CEP Root：$($recommendation.Root.Path)`r`n推荐原因：$($recommendation.Reason)";$csxsText=if($csxs.Count){'CEP 调试模式：'+(($csxs|ForEach-Object{"$($_.Name)="+$(if($_.Enabled){'1'}else{'未启用'})}) -join '；')}else{'CEP 调试模式：未检测到 CSXS key'};$status.Text="$formalText`r`n`r`n$compatText`r`n`r`n$rootText`r`n`r`n$csxsText"
    $uninstallButton.Enabled=$state.CompatInstalled;$open.Enabled=$true;Update-SelectionUi;Write-SafeLog ("detected cep roots={0}; recommended={1}; selected={2}; formal={3}; compat={4}" -f (($roots|ForEach-Object{"$($_.Type):$($_.Path):exists=$($_.Exists):admin=$($_.RequiresAdmin)"}) -join '|'),$recommendation.Root.Path,$script:SelectedRoot.Path,(($state.FormalLocations.Path)-join '|'),(($state.CompatLocations.Path)-join '|'));$script:Refreshing=$false
  }

  $rootCombo.Add_SelectedIndexChanged({if($script:Refreshing){return};if($rootCombo.SelectedIndex -ge 0){$script:SelectedRoot=$script:RootOptions[$rootCombo.SelectedIndex].Root;Update-SelectionUi}})
  $rescan.Add_Click({Refresh-UI});$installButton.Add_Click({if(Invoke-Install -TargetRoot $script:SelectedRoot.Path -DebugMode:$debug.Checked){Refresh-UI}})
  $uninstallButton.Add_Click({& (Join-Path $PSScriptRoot 'uninstall.ps1');Refresh-UI})
  $open.Add_Click({$target=if($script:PrimaryCompat){$script:PrimaryCompat.Path}else{$script:SelectedRoot.Path};if(Test-Path -LiteralPath $target){Start-Process explorer.exe -ArgumentList @($target)}else{[Windows.Forms.MessageBox]::Show("目录尚不存在：`r`n$target",'查看安装位置','OK','Information')|Out-Null}})
  $guide.Add_Click({[Windows.Forms.MessageBox]::Show('目标范围：Photoshop 23.x–25.x。安装器只检测、提示并部署到用户确认的 CEP Root；运行时会继续执行 Host 能力检测。','兼容说明','OK','Information')|Out-Null})
  Refresh-UI;[void]$form.ShowDialog()
} catch { Show-InstallerStartupError -ErrorRecord $_;exit 1 }
