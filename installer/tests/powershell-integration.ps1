$ErrorActionPreference='Stop'
$installerRoot=Split-Path -Parent $PSScriptRoot
$testRoot=[IO.Path]::GetFullPath((Join-Path $installerRoot 'build\test-env'))
$allowedRoot=[IO.Path]::GetFullPath((Join-Path $installerRoot 'build'))
if(-not $testRoot.StartsWith($allowedRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe integration test root.'}
if(Test-Path -LiteralPath $testRoot){Remove-Item -LiteralPath $testRoot -Recurse -Force};New-Item -ItemType Directory -Path $testRoot -Force|Out-Null
$previousAppData=$env:APPDATA;$previousLocalAppData=$env:LOCALAPPDATA
try{
  $env:APPDATA=Join-Path $testRoot 'AppData\Roaming';$env:LOCALAPPDATA=Join-Path $testRoot 'AppData\Local'
  $chinesePackageRoot=Join-Path $testRoot '中文 用户\IExpress 解包目录';Copy-Item -LiteralPath (Join-Path $installerRoot 'build\package') -Destination $chinesePackageRoot -Recurse -Force
  Push-Location $testRoot;try{$startupOutput=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $chinesePackageRoot 'install.ps1') -Action ValidateStartup 2>&1;$startupExit=$LASTEXITCODE}finally{Pop-Location}
  if($startupExit -ne 0 -or ([string]($startupOutput -join "`n")) -notmatch 'PASS: installer startup resources loaded'){throw "Chinese-path/CWD-independent startup validation failed: $startupOutput"}
  Import-Module (Join-Path $installerRoot 'src\filesystemAdapter.psm1') -Force
  $rootOverrides=@{'system-x86'=(Join-Path $testRoot 'roots\System x86 CEP');'system-x64'=(Join-Path $testRoot 'roots\System x64 CEP');'user'=(Join-Path $testRoot 'roots\中文用户 CEP')}
  foreach($path in $rootOverrides.Values){New-Item -ItemType Directory -Path $path -Force|Out-Null}
  $roots=@(Detect-CepRoots -RootOverrides $rootOverrides -Administrator $true)
  if($roots.Count -ne 3 -or -not($roots|Where-Object{$_.Type -eq 'system-x86' -and $_.RequiresAdmin -and $_.Writable})){throw 'CEP root detection mock failed.'}
  $formalPath=Join-Path $rootOverrides['system-x86'] 'PS-AI-Image-Hub-CEP';New-Item -ItemType Directory -Path $formalPath -Force|Out-Null;Set-Content -LiteralPath (Join-Path $formalPath 'formal-marker.txt') -Value 'formal-preserved' -Encoding UTF8
  $dataPath=Get-CompatDataPath;New-Item -ItemType Directory -Path $dataPath -Force|Out-Null;Set-Content -LiteralPath (Join-Path $dataPath 'data-marker.txt') -Value 'data-preserved' -Encoding UTF8
  $payload=Join-Path $testRoot 'payload';Expand-Archive -LiteralPath (Join-Path $installerRoot 'build\payload.zip') -DestinationPath $payload -Force
  $hashes=Get-Content -LiteralPath (Join-Path $installerRoot 'build\runtime-hashes.json') -Raw -Encoding UTF8|ConvertFrom-Json
  $state=Get-CepInstallState $roots;$recommendation=Select-RecommendedCepRoot $roots $state;if($recommendation.Root.Type -ne 'system-x86'){throw 'Recommendation did not follow formal plugin root.'}
  $systemResult=Install-CompatTransactional -PayloadRoot $payload -Hashes $hashes -TargetRoot $rootOverrides['system-x86'] -Roots $roots
  if(-not $systemResult.Success -or -not(Test-RuntimeHashes $systemResult.Path $hashes)){throw 'System-root install failed.'}
  $repair=Install-CompatTransactional -PayloadRoot $payload -Hashes $hashes -TargetRoot $rootOverrides['system-x86'] -Roots $roots
  if(-not $repair.Updated -or -not(Test-RuntimeHashes $repair.Path $hashes)){throw 'System-root repair/update failed.'}
  $corruptPayload=Join-Path $testRoot 'corrupt-payload';Copy-Item -LiteralPath $payload -Destination $corruptPayload -Recurse -Force;$firstRelative=([string]$hashes[0].path)-replace '/','\';Add-Content -LiteralPath (Join-Path $corruptPayload $firstRelative) -Value 'intentional-test-corruption' -Encoding UTF8
  $rejected=$false;try{Install-CompatTransactional -PayloadRoot $corruptPayload -Hashes $hashes -TargetRoot $rootOverrides['system-x86'] -Roots $roots|Out-Null}catch{$rejected=$true}
  if(-not $rejected -or -not(Test-RuntimeHashes $systemResult.Path $hashes)){throw 'Corrupt system payload did not preserve installed runtime.'}
  $deleteRefused=$false;try{Uninstall-CompatRuntime -TargetPath $formalPath -Roots $roots}catch{$deleteRefused=$true};if(-not $deleteRefused){throw 'Formal plugin delete target was not rejected.'}
  Uninstall-CompatRuntime -TargetPath $systemResult.Path -Roots $roots
  if(Test-Path -LiteralPath $systemResult.Path){throw 'System Compat runtime was not removed.'};if(-not(Test-Path -LiteralPath (Join-Path $formalPath 'formal-marker.txt'))){throw 'Formal plugin fixture was modified.'};if(-not(Test-Path -LiteralPath (Join-Path $dataPath 'data-marker.txt'))){throw 'Compat data was not preserved.'}
  $userResult=Install-CompatTransactional -PayloadRoot $payload -Hashes $hashes -TargetRoot $rootOverrides['user'] -Roots $roots;if(-not $userResult.Success){throw 'User-root install failed.'};Uninstall-CompatRuntime -TargetPath $userResult.Path -Roots $roots;if(Test-Path -LiteralPath $userResult.Path){throw 'User-root uninstall failed.'}
  Write-Output 'PASS: PowerShell multi-root install/repair/update/rollback/uninstall integration test.'
}finally{$env:APPDATA=$previousAppData;$env:LOCALAPPDATA=$previousLocalAppData}
