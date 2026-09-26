Set-StrictMode -Version Latest

$script:CompatFolder = 'PS-AI-Image-Hub-CEP11-Compat'
$script:FormalFolder = 'PS-AI-Image-Hub-CEP'
$script:CompatBundleId = 'com.psai.imagehub.compat.cep11'
$script:CompatExtensionId = 'com.psai.imagehub.compat.cep11.panel'

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-FullPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
}

function Detect-CepRoots {
  param([hashtable]$RootOverrides, [object]$Administrator = $null)
  $systemX86 = if ($RootOverrides -and $RootOverrides.ContainsKey('system-x86')) { [string]$RootOverrides['system-x86'] } elseif (${env:CommonProgramFiles(x86)}) { Join-Path ${env:CommonProgramFiles(x86)} 'Adobe\CEP\extensions' } else { Join-Path ${env:ProgramFiles(x86)} 'Common Files\Adobe\CEP\extensions' }
  $systemX64 = if ($RootOverrides -and $RootOverrides.ContainsKey('system-x64')) { [string]$RootOverrides['system-x64'] } elseif ($env:CommonProgramFiles) { Join-Path $env:CommonProgramFiles 'Adobe\CEP\extensions' } else { Join-Path $env:ProgramFiles 'Common Files\Adobe\CEP\extensions' }
  $userRoot = if ($RootOverrides -and $RootOverrides.ContainsKey('user')) { [string]$RootOverrides['user'] } else { Join-Path $env:APPDATA 'Adobe\CEP\extensions' }
  $isAdmin = if ($null -ne $Administrator) { [bool]$Administrator } else { Test-IsAdministrator }
  $definitions = @(
    [pscustomobject]@{ Type='system-x86'; Path=$systemX86; RequiresAdmin=$true; Order=1 },
    [pscustomobject]@{ Type='system-x64'; Path=$systemX64; RequiresAdmin=$true; Order=2 },
    [pscustomobject]@{ Type='user'; Path=$userRoot; RequiresAdmin=$false; Order=0 }
  )
  return @($definitions | ForEach-Object {
    $full = Get-FullPath $_.Path
    [pscustomobject]@{ Path=$full; Type=$_.Type; Exists=(Test-Path -LiteralPath $full -PathType Container); Writable=$(if($_.RequiresAdmin){$isAdmin}else{$true}); RequiresAdmin=$_.RequiresAdmin; Order=$_.Order }
  })
}

function Get-ExtensionManifestInfo {
  param([string]$ExtensionPath)
  $manifestPath = Join-Path $ExtensionPath 'CSXS\manifest.xml'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { return [pscustomobject]@{ ManifestPath=$manifestPath; Exists=$false; BundleId=$null; ExtensionId=$null; Version=$null; DisplayName=$null } }
  try {
    $xml = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
    function Match-ManifestValue([string]$Pattern) { $match=[regex]::Match($xml,$Pattern); if($match.Success){return $match.Groups[1].Value}; return $null }
    return [pscustomobject]@{ ManifestPath=$manifestPath; Exists=$true; BundleId=(Match-ManifestValue 'ExtensionBundleId="([^"]+)"'); ExtensionId=(Match-ManifestValue '<Extension\s+Id="([^"]+)"'); Version=(Match-ManifestValue 'ExtensionBundleVersion="([^"]+)"'); DisplayName=(Match-ManifestValue 'ExtensionBundleName="([^"]+)"') }
  } catch { return [pscustomobject]@{ ManifestPath=$manifestPath; Exists=$true; BundleId=$null; ExtensionId=$null; Version=$null; DisplayName=$null } }
}

function Get-CepInstallState {
  param([object[]]$Roots)
  if (-not $Roots) { $Roots = Detect-CepRoots }
  $formal = @(); $compat = @()
  foreach ($root in $Roots) {
    $formalPath = Join-Path $root.Path $script:FormalFolder
    if (Test-Path -LiteralPath $formalPath -PathType Container) { $metadata=Get-ExtensionManifestInfo $formalPath; $formal += [pscustomobject]@{ Root=$root; RootPath=$root.Path; Path=$formalPath; Version=$metadata.Version; Metadata=$metadata } }
    $compatPath = Join-Path $root.Path $script:CompatFolder
    if (Test-Path -LiteralPath $compatPath -PathType Container) { $metadata=Get-ExtensionManifestInfo $compatPath; $valid=$metadata.BundleId -eq $script:CompatBundleId -and $metadata.ExtensionId -eq $script:CompatExtensionId; $compat += [pscustomobject]@{ Root=$root; RootPath=$root.Path; Path=$compatPath; Version=$metadata.Version; IdentityValid=$valid; Metadata=$metadata } }
  }
  return [pscustomobject]@{ FormalInstalled=$formal.Count -gt 0; FormalLocations=@($formal); CompatInstalled=$compat.Count -gt 0; CompatLocations=@($compat); DuplicateCompat=$compat.Count -gt 1 }
}

function Select-RecommendedCepRoot {
  param([object[]]$Roots, [object]$InstallState)
  if (-not $Roots) { $Roots = Detect-CepRoots }
  if (-not $InstallState) { $InstallState = Get-CepInstallState -Roots $Roots }
  if ($InstallState.FormalLocations.Count -eq 1) { return [pscustomobject]@{ Root=$InstallState.FormalLocations[0].Root; Reason='检测到旧版 PS AI Image Hub 位于该 CEP 目录。'; Source='formal' } }
  if ($InstallState.FormalLocations.Count -eq 0 -and $InstallState.CompatLocations.Count -eq 1) { return [pscustomobject]@{ Root=$InstallState.CompatLocations[0].Root; Reason='检测到现有安装；更新和修复必须继续使用该位置。'; Source='compat' } }
  if ($InstallState.FormalLocations.Count -gt 0) {
    foreach ($formal in $InstallState.FormalLocations) { if ($InstallState.CompatLocations | Where-Object { $_.RootPath -eq $formal.RootPath }) { return [pscustomobject]@{ Root=$formal.Root; Reason='检测到旧版与当前版本同位于该 CEP 目录。'; Source='formal-and-compat' } } }
    return [pscustomobject]@{ Root=$InstallState.FormalLocations[0].Root; Reason='检测到多个旧版位置；优先使用首个已确认 CEP 目录。'; Source='formal-multiple' }
  }
  if ($InstallState.CompatLocations.Count -gt 0) { return [pscustomobject]@{ Root=$InstallState.CompatLocations[0].Root; Reason='检测到现有安装；推荐保留其中一个实际安装位置。'; Source='compat-multiple' } }
  foreach ($type in @('user','system-x86','system-x64')) {
    $candidate = $Roots | Where-Object { $_.Type -eq $type -and $_.Exists -and $_.Writable } | Select-Object -First 1
    if ($candidate) { $reason=if($type -eq 'user'){'当前未检测到正式版；该用户 CEP 目录已存在且无需管理员权限。'}else{'当前未检测到正式版；该 System CEP 目录已存在且当前具备写入权限。'}; return [pscustomobject]@{ Root=$candidate; Reason=$reason; Source='existing-writable' } }
  }
  foreach ($type in @('system-x86','system-x64')) { $candidate=$Roots|Where-Object{$_.Type -eq $type -and $_.Exists}|Select-Object -First 1; if($candidate){return [pscustomobject]@{Root=$candidate;Reason='当前未检测到正式版；该 System CEP 目录已存在，但写入时需要管理员权限。';Source='existing-system'}} }
  $user=$Roots|Where-Object{$_.Type -eq 'user'}|Select-Object -First 1
  return [pscustomobject]@{ Root=$user; Reason='未检测到现有 CEP Root；仅在用户确认安装后创建所选的用户 CEP 目录。'; Source='create-selected-only' }
}

function Get-PrimaryCompatLocation {
  param([object]$InstallState, [object]$Recommendation, [object]$Persisted)
  if ($Persisted -and $Persisted.InstallPath) { $match=$InstallState.CompatLocations|Where-Object{(Get-FullPath $_.Path) -eq (Get-FullPath $Persisted.InstallPath)}|Select-Object -First 1; if($match){return $match} }
  if ($InstallState.CompatLocations.Count -eq 1) { return $InstallState.CompatLocations[0] }
  if ($Recommendation -and $Recommendation.Root) { $match=$InstallState.CompatLocations|Where-Object{$_.RootPath -eq $Recommendation.Root.Path}|Select-Object -First 1; if($match){return $match} }
  return $InstallState.CompatLocations | Select-Object -First 1
}

function Get-CompatTargetPath { param([Parameter(Mandatory=$true)][string]$TargetRoot); return Join-Path (Get-FullPath $TargetRoot) $script:CompatFolder }

function Assert-SafeCompatTarget {
  param([Parameter(Mandatory=$true)][string]$TargetPath, [object[]]$Roots, [switch]$RequireExistingIdentity)
  $actual=Get-FullPath $TargetPath
  if ((Split-Path -Leaf $actual) -cne $script:CompatFolder) { throw 'Unsafe Compat target folder name.' }
  if (-not $Roots) { $Roots=Detect-CepRoots }
  $parent=Get-FullPath (Split-Path -Parent $actual)
  if (-not ($Roots|Where-Object{(Get-FullPath $_.Path) -eq $parent})) { throw 'Compat target is outside known CEP roots.' }
  if ($RequireExistingIdentity -and (Test-Path -LiteralPath $actual -PathType Container)) { $metadata=Get-ExtensionManifestInfo $actual; if($metadata.BundleId -ne $script:CompatBundleId -or $metadata.ExtensionId -ne $script:CompatExtensionId){throw 'Compat target identity validation failed; deletion refused.'} }
  return $actual
}

function Get-CompatDataPath { return Join-Path $env:APPDATA 'Adobe\PSAIImageHubCompat' }

function Test-RuntimeHashes {
  param([string]$Root, [object[]]$Hashes)
  foreach($entry in $Hashes){$relative=[string]$entry.path;if($relative -match '(^|[\\/])\.\.([\\/]|$)' -or [IO.Path]::IsPathRooted($relative)){return $false};$file=Join-Path $Root ($relative -replace '/','\');if(-not(Test-Path -LiteralPath $file -PathType Leaf)){return $false};if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()){return $false}}
  return @(Get-ChildItem -LiteralPath $Root -File -Recurse -Force).Count -eq $Hashes.Count
}

function Install-CompatTransactional {
  param([string]$PayloadRoot,[object[]]$Hashes,[Parameter(Mandatory=$true)][string]$TargetRoot,[object[]]$Roots)
  if(-not $Roots){$Roots=Detect-CepRoots};$targetPath=Get-CompatTargetPath $TargetRoot;Assert-SafeCompatTarget -TargetPath $targetPath -Roots $Roots|Out-Null
  if(-not(Test-RuntimeHashes $PayloadRoot $Hashes)){throw 'Packaged runtime hash validation failed.'};New-Item -ItemType Directory -Path $TargetRoot -Force|Out-Null
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmssfff';$backup=Join-Path $env:TEMP "PSAIImageHubCompatBackup\$stamp";$stage=Join-Path $TargetRoot ".$($script:CompatFolder)-installing-$stamp";$hadExisting=Test-Path -LiteralPath $targetPath;if($hadExisting){Assert-SafeCompatTarget -TargetPath $targetPath -Roots $Roots -RequireExistingIdentity|Out-Null};$backupReady=$false
  try { if($hadExisting){New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force|Out-Null;Copy-Item -LiteralPath $targetPath -Destination $backup -Recurse -Force;$backupReady=$true};Copy-Item -LiteralPath $PayloadRoot -Destination $stage -Recurse -Force;if(-not(Test-RuntimeHashes $stage $Hashes)){throw 'Staged runtime hash validation failed.'};if($hadExisting){Remove-Item -LiteralPath $targetPath -Recurse -Force};Move-Item -LiteralPath $stage -Destination $targetPath;if(-not(Test-RuntimeHashes $targetPath $Hashes)){throw 'Installed runtime hash validation failed.'};if(Test-Path -LiteralPath $backup){Remove-Item -LiteralPath $backup -Recurse -Force};return [pscustomobject]@{Success=$true;Updated=$hadExisting;Rollback=$false;Root=(Get-FullPath $TargetRoot);Path=$targetPath}
  } catch { if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force};if($backupReady){if(Test-Path -LiteralPath $targetPath){Remove-Item -LiteralPath $targetPath -Recurse -Force};if(Test-Path -LiteralPath $backup){Move-Item -LiteralPath $backup -Destination $targetPath}}elseif(Test-Path -LiteralPath $backup){Remove-Item -LiteralPath $backup -Recurse -Force};throw }
}

function Uninstall-CompatRuntime {
  param([Parameter(Mandatory=$true)][string]$TargetPath,[switch]$RemoveData,[object[]]$Roots)
  $safeTarget=Assert-SafeCompatTarget -TargetPath $TargetPath -Roots $Roots -RequireExistingIdentity;if(Test-Path -LiteralPath $safeTarget){Remove-Item -LiteralPath $safeTarget -Recurse -Force};$dataPath=Get-CompatDataPath;if($RemoveData -and (Test-Path -LiteralPath $dataPath)){Remove-Item -LiteralPath $dataPath -Recurse -Force}
}

Export-ModuleMember -Function Test-IsAdministrator,Detect-CepRoots,Get-ExtensionManifestInfo,Get-CepInstallState,Select-RecommendedCepRoot,Get-PrimaryCompatLocation,Get-CompatTargetPath,Assert-SafeCompatTarget,Get-CompatDataPath,Test-RuntimeHashes,Install-CompatTransactional,Uninstall-CompatRuntime
