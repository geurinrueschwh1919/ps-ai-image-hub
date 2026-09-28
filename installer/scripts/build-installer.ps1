$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$installerRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $installerRoot
$formalRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $projectRoot) 'adobe-photoshop-uxp-ps-ai-image'))
$stagingRoot = Join-Path $projectRoot 'outputs\dev\PS-AI-Image-Hub-CEP11-Compat'
$buildRoot = Join-Path $installerRoot 'build'
$runtimeCopy = Join-Path $buildRoot 'runtime'
$packageRoot = Join-Path $buildRoot 'package'
$distRoot = Join-Path $installerRoot 'dist'
$reportRoot = Join-Path $installerRoot 'reports'
$outputName = 'PS-AI-Image-Hub-Setup-v1.0.2.exe'
$outputPath = Join-Path $distRoot $outputName
$debugOutputName = 'PS-AI-Image-Hub-Setup-v1.0.2-Debug.exe'
$debugOutputPath = Join-Path $distRoot $debugOutputName
$expectedFormalHash = 'f238bc372fe326cf79e76cad47b4308b097c30d3235e4788a0a4fa48806f18fd'

function Get-TreeStats([string]$Root) {
  $treeHash = Join-Path $projectRoot 'scripts\tree-hash.js'
  $code = 'const {scanTree}=require(process.argv[1]);const x=scanTree(process.argv[2]);delete x.rows;console.log(JSON.stringify(x));'
  $output = & node -e $code $treeHash $Root
  if ($LASTEXITCODE -ne 0) { throw "Could not hash tree: $Root" }
  return ($output | ConvertFrom-Json)
}

function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Assert-Staging {
  if (-not (Test-Path -LiteralPath $stagingRoot -PathType Container)) { throw 'Compat staging is missing.' }
  foreach ($name in @('CSXS','client','host')) { if (-not (Test-Path -LiteralPath (Join-Path $stagingRoot $name) -PathType Container)) { throw "Compat staging is missing required directory: $name" } }
  $manifestPath = Join-Path $stagingRoot 'CSXS\manifest.xml'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Compat staging is missing manifest.' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
  $checks = @(
    @('ExtensionBundleId="com\.psai\.imagehub\.compat\.cep11"','Bundle ID'),
    @('Id="com\.psai\.imagehub\.compat\.cep11\.panel"','Extension ID'),
    @('ExtensionBundleName="PS AI Image Hub"','Display Name'),
    @('<Host Name="PHSP" Version="\[23\.0,26\.0\)"','Host Range')
  )
  foreach ($check in $checks) { if ($manifest -notmatch $check[0]) { throw "Compat manifest identity mismatch: $($check[1])" } }
  return $manifest
}

$formalBefore = Get-TreeStats $formalRoot
if ($formalBefore.aggregateSha256 -ne $expectedFormalHash) { throw 'Formal project baseline changed externally.' }
$stagingBefore = Get-TreeStats $stagingRoot
$manifest = Assert-Staging

foreach ($directory in @($runtimeCopy,$packageRoot)) {
  if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force }
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
foreach ($directory in @($distRoot,$reportRoot)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
Get-ChildItem -LiteralPath $stagingRoot -Force | Copy-Item -Destination $runtimeCopy -Recurse -Force

$runtimeFiles = @(Get-ChildItem -LiteralPath $runtimeCopy -File -Recurse -Force | Sort-Object { $_.FullName.Substring($runtimeCopy.Length).Replace('\','/') })
$hashes = @($runtimeFiles | ForEach-Object {
  [ordered]@{ path = $_.FullName.Substring($runtimeCopy.Length + 1).Replace('\','/'); size = $_.Length; sha256 = Get-Sha256 $_.FullName }
})
$hashes | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $buildRoot 'runtime-hashes.json') -Encoding UTF8

function Match-One([string]$Pattern) { $m=[regex]::Match($manifest,$Pattern); if(-not $m.Success){throw "Manifest parse failed: $Pattern"}; return $m.Groups[1].Value }
$metadata = [ordered]@{
  displayName = Match-One 'ExtensionBundleName="([^"]+)"'
  bundleId = Match-One 'ExtensionBundleId="([^"]+)"'
  bundleVersion = Match-One 'ExtensionBundleVersion="([^"]+)"'
  extensionId = Match-One '<Extension\s+Id="([^"]+)"'
  extensionVersion = Match-One '<Extension\s+Id="[^"]+"\s+Version="([^"]+)"'
  hostRange = Match-One '<Host\s+Name="PHSP"\s+Version="([^"]+)"'
  versionLabel = 'v1.0.2'
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $buildRoot 'metadata.json') -Encoding UTF8

$payloadZip = Join-Path $buildRoot 'payload.zip'
if (Test-Path -LiteralPath $payloadZip) { Remove-Item -LiteralPath $payloadZip -Force }
Compress-Archive -Path (Join-Path $runtimeCopy '*') -DestinationPath $payloadZip -CompressionLevel Optimal
foreach ($name in @('install.ps1','uninstall.ps1','registryDetector.psm1','filesystemAdapter.psm1','launch-installer.cmd','launch-installer-debug.cmd')) { Copy-Item -LiteralPath (Join-Path $installerRoot "src\$name") -Destination (Join-Path $packageRoot $name) -Force }
Copy-Item -LiteralPath $payloadZip,(Join-Path $buildRoot 'runtime-hashes.json'),(Join-Path $buildRoot 'metadata.json') -Destination $packageRoot -Force

$packageFiles = @(Get-ChildItem -LiteralPath $packageRoot -File | Sort-Object Name)
$strings = @(); $entries = @()
for ($i=0; $i -lt $packageFiles.Count; $i++) { $strings += "FILE$i=$($packageFiles[$i].Name)"; $entries += "%FILE$i%=" }

function New-IExpressConfig {
  param([string]$TargetFileName, [string]$LaunchCommand, [string]$SedFileName)
  $sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=..\dist\$TargetFileName
FriendlyName=PS AI Image Hub Installer
AppLaunched=$LaunchCommand
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles
[Strings]
$($strings -join "`r`n")
[SourceFiles]
SourceFiles0=package\
[SourceFiles0]
$($entries -join "`r`n")
"@
  $sed | Set-Content -LiteralPath (Join-Path $buildRoot $SedFileName) -Encoding ASCII
}

# Keep unsigned IExpress artifacts as build outputs for future Authenticode signing,
# but do not make them the public installation path. Direct PowerShell launch avoids
# the cmd child-process chain that Windows can terminate before install.ps1 starts.
New-IExpressConfig -TargetFileName $outputName -LaunchCommand 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File install.ps1' -SedFileName 'installer.sed'
New-IExpressConfig -TargetFileName $debugOutputName -LaunchCommand 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -NoExit -File install.ps1' -SedFileName 'installer-debug.sed'
foreach ($path in @($outputPath,$debugOutputPath)) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
Push-Location $buildRoot
try {
  & "$env:SystemRoot\System32\iexpress.exe" /N 'installer.sed' | Out-Null
  & "$env:SystemRoot\System32\iexpress.exe" /N 'installer-debug.sed' | Out-Null
}
finally { Pop-Location }
if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf)) { throw 'IExpress did not produce installer output.' }
if (-not (Test-Path -LiteralPath $debugOutputPath -PathType Leaf)) { throw 'IExpress did not produce debug installer output.' }

$formalAfter = Get-TreeStats $formalRoot
$stagingAfter = Get-TreeStats $stagingRoot
if ($formalAfter.aggregateSha256 -ne $formalBefore.aggregateSha256) { throw 'Formal project changed during installer build.' }
if ($stagingAfter.aggregateSha256 -ne $stagingBefore.aggregateSha256) { throw 'Compat staging changed during installer build.' }
$installerFile = Get-Item -LiteralPath $outputPath
$installerHash = Get-Sha256 $outputPath
$debugInstallerFile = Get-Item -LiteralPath $debugOutputPath
$debugInstallerHash = Get-Sha256 $debugOutputPath
$runtimeFileCount = $runtimeFiles.Count
$runtimeSize = ($runtimeFiles | Measure-Object -Property Length -Sum).Sum
$compatVersion = $metadata['bundleVersion']
$displayName = $metadata['displayName']
$bundleId = $metadata['bundleId']
$extensionId = $metadata['extensionId']
$hostRange = $metadata['hostRange']
$report = @"
# Installer Build Report

- Build date: $(Get-Date -Format o)
- Installer technology: Windows IExpress + Windows PowerShell transactional installer (Inno Setup/NSIS unavailable locally)
- Installer version: v1.0.2 / $compatVersion
- Compat source path: $stagingRoot
- Compat version: $compatVersion
- Display name: $displayName
- Bundle ID: $bundleId
- Extension ID: $extensionId
- Host range: $hostRange
- Runtime file count: $runtimeFileCount
- Runtime size: $runtimeSize bytes
- Runtime tree hash: $($stagingBefore.aggregateSha256)
- Hash manifest: installer/build/runtime-hashes.json
- Installer size: $($installerFile.Length) bytes
- Installer SHA-256: $installerHash
- Output path: $outputPath
- Debug installer size: $($debugInstallerFile.Length) bytes
- Debug installer SHA-256: $debugInstallerHash
- Debug output path: $debugOutputPath
- IExpress AppLaunched: powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File install.ps1
- Debug AppLaunched: powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -NoExit -File install.ps1
- Package files: $($packageFiles.Name -join ', ')
- Formal project hash before/after: $($formalBefore.aggregateSha256) / $($formalAfter.aggregateSha256)
- Compat staging hash before/after: $($stagingBefore.aggregateSha256) / $($stagingAfter.aggregateSha256)
- Result: **PASS**

The EXE contains no Node, Python, Electron, or bundled .NET runtime. It uses Windows PowerShell and Windows-native IExpress available on the target system. These unsigned EXEs are retained only as local build artifacts for future trusted signing and are not included in the public ZIP.
"@
$report | Set-Content -LiteralPath (Join-Path $reportRoot 'INSTALLER_BUILD_REPORT.md') -Encoding UTF8
Write-Output "Installer built: $outputPath"
Write-Output "Size: $($installerFile.Length)"
Write-Output "SHA256: $installerHash"
Write-Output "Debug installer built: $debugOutputPath"
