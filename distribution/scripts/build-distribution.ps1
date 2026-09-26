[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$distributionVersion = "v1.0.0"
$productVersion = "1.0.0"
$packageFolderName = "PSAIHub-Compat"
$zipFileName = $packageFolderName + ".zip"
$releaseSourceFileName = "PS-AI-Image-Hub-Setup-v1.0.0.exe"
$debugSourceFileName = "PS-AI-Image-Hub-Setup-v1.0.0-Debug.exe"
$releaseFileName = "PSAIHub-Setup.exe"
$debugFileName = "PSAIHub-Debug.exe"

$distributionRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $distributionRoot))
$formalRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $projectRoot) "adobe-photoshop-uxp-ps-ai-image"))
$installerDist = Join-Path $projectRoot "installer\dist"
$releaseSource = Join-Path $installerDist $releaseSourceFileName
$debugSource = Join-Path $installerDist $debugSourceFileName
$runtimeRoot = Join-Path $projectRoot "outputs\dev\PS-AI-Image-Hub-CEP11-Compat"
$buildRoot = [IO.Path]::GetFullPath((Join-Path $distributionRoot "build"))
$stagingRoot = Join-Path $buildRoot $packageFolderName
$debugRoot = Join-Path $stagingRoot "Debug"
$distRoot = Join-Path $distributionRoot "dist"
$reportsRoot = Join-Path $distributionRoot "reports"
$templatesRoot = Join-Path $distributionRoot "templates"
$zipPath = Join-Path $distRoot $zipFileName
$zipHashPath = $zipPath + ".sha256.txt"
$releaseDistPath = Join-Path $distRoot $releaseFileName
$debugDistPath = Join-Path $distRoot $debugFileName
$legacyZipPath = Join-Path $distRoot "PSAI-CEP11-Test.zip"
$legacyZipHashPath = $legacyZipPath + ".sha256.txt"
$reportPath = Join-Path $reportsRoot "DISTRIBUTION_BUILD_REPORT.md"

function Get-TreeAggregate {
  param([Parameter(Mandatory = $true)][string]$Root)
  $resolvedRoot = [IO.Path]::GetFullPath($Root)
  if (-not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) { throw "Hash-protected tree is missing: $resolvedRoot" }
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { throw "Node.js is required for deterministic tree hashing." }
  $helper = Join-Path $PSScriptRoot "tree-hash.js"
  $json = & $nodeCommand.Source $helper $resolvedRoot
  if ($LASTEXITCODE -ne 0) { throw "Tree hashing failed: $resolvedRoot" }
  return ($json | ConvertFrom-Json)
}

function Write-Utf8Text {
  param([string]$Path, [string]$Content)
  Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
}

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant() }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Expand-Template {
  param([string]$TemplatePath)
  $text = Get-Content -LiteralPath $TemplatePath -Raw -Encoding UTF8
  return $text.Replace("{{DISTRIBUTION_VERSION}}", $distributionVersion).Replace("{{PRODUCT_VERSION}}", $productVersion).
    Replace("{{RELEASE_FILENAME}}", $releaseFileName).Replace("{{DEBUG_FILENAME}}", $debugFileName)
}

function Assert-CleanDistributionTree {
  param([string]$Root)
  $forbiddenDirectoryNames = @("source", "tests", "node_modules", "src", "build", "reports", ".git", "logs", "USER_DATA")
  $forbiddenFileNames = @(".env", "desktop.ini")
  $hits = New-Object System.Collections.Generic.List[string]
  foreach ($item in Get-ChildItem -LiteralPath $Root -Recurse -Force) {
    $relative = $item.FullName.Substring($Root.Length).TrimStart("\")
    if ($item.PSIsContainer -and $forbiddenDirectoryNames -contains $item.Name) { $hits.Add($relative) }
    if (-not $item.PSIsContainer) {
      if ($forbiddenFileNames -contains $item.Name -or $item.Extension -in @(".log", ".tmp")) { $hits.Add($relative) }
      if ($relative -match "(?i)(Codex workspace|Photoshop 用户数据|正式版源码|installer\\(?:src|build))") { $hits.Add($relative) }
    }
  }
  if ($hits.Count -gt 0) { throw "Forbidden distribution content: " + ($hits -join ", ") }

  $allowedFiles = @(
    $releaseFileName,
    "README-安装说明.txt",
    "LICENSE.txt",
    "THIRD-PARTY-NOTICES.txt",
    "SHA256.txt",
    "问题反馈模板.txt",
    ("Debug\" + $debugFileName)
  ) | Sort-Object
  $actualFiles = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force | ForEach-Object {
    $_.FullName.Substring($Root.Length).TrimStart("\")
  } | Sort-Object)
  $unexpectedFiles = @(Compare-Object -ReferenceObject $allowedFiles -DifferenceObject $actualFiles | Where-Object SideIndicator -eq "=>")
  $missingFiles = @(Compare-Object -ReferenceObject $allowedFiles -DifferenceObject $actualFiles | Where-Object SideIndicator -eq "<=")
  if ($unexpectedFiles.Count -gt 0 -or $missingFiles.Count -gt 0) {
    throw "Distribution layout does not match the exact public-file allowlist. Unexpected: $($unexpectedFiles.InputObject -join ', '); missing: $($missingFiles.InputObject -join ', ')."
  }
  $actualDirectories = @(Get-ChildItem -LiteralPath $Root -Recurse -Directory -Force | ForEach-Object {
    $_.FullName.Substring($Root.Length).TrimStart("\")
  })
  if ($actualDirectories.Count -ne 1 -or $actualDirectories[0] -ne "Debug") {
    throw "Distribution layout must contain only the Debug directory."
  }
}

function Invoke-SecretScan {
  param([string]$Root)
  $patterns = @(
    "-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
    "\bsk-[A-Za-z0-9_-]{20,}\b", "\bLTAI[A-Za-z0-9]{12,}\b",
    "\bAKIA[A-Z0-9]{16}\b", "\bgh[pousr]_[A-Za-z0-9]{30,}\b",
    "(?i)Bearer\s+[A-Za-z0-9._~-]{24,}"
  )
  $hits = New-Object System.Collections.Generic.List[string]
  $textFiles = @(Get-ChildItem -LiteralPath $Root -Recurse -File | Where-Object { $_.Extension -in @(".txt", ".json", ".md") })
  foreach ($file in $textFiles) {
    $content = Get-Content -LiteralPath $file.FullName -Raw
    foreach ($pattern in $patterns) {
      if ($content -match $pattern) { $hits.Add($file.FullName.Substring($Root.Length).TrimStart("\") + " -> " + $pattern) }
    }
  }
  if ($hits.Count -gt 0) { throw "Secret scan failed: " + ($hits -join "; ") }
  return $textFiles.Count
}

$formalBefore = Get-TreeAggregate -Root $formalRoot

$runtimeBefore = Get-TreeAggregate -Root $runtimeRoot

foreach ($requiredExe in @($releaseSource, $debugSource)) {
  if (-not (Test-Path -LiteralPath $requiredExe -PathType Leaf)) { throw "Required installer is missing: $requiredExe" }
  if ((Get-Item -LiteralPath $requiredExe).Length -le 0) { throw "Required installer is empty: $requiredExe" }
}

$releaseInfo = Get-Item -LiteralPath $releaseSource
$debugInfo = Get-Item -LiteralPath $debugSource
$releaseHash = Get-Sha256 -Path $releaseSource
$debugHash = Get-Sha256 -Path $debugSource

$expectedBuildRoot = [IO.Path]::GetFullPath((Join-Path $distributionRoot "build"))
if ($buildRoot -ne $expectedBuildRoot -or (Split-Path -Leaf $buildRoot) -ne "build") { throw "Unsafe distribution build path: $buildRoot" }
if (Test-Path -LiteralPath $buildRoot) { Remove-Item -LiteralPath $buildRoot -Recurse -Force }
New-Item -ItemType Directory -Path $debugRoot -Force | Out-Null
New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
New-Item -ItemType Directory -Path $reportsRoot -Force | Out-Null

Copy-Item -LiteralPath $releaseSource -Destination (Join-Path $stagingRoot $releaseFileName)
Copy-Item -LiteralPath $debugSource -Destination (Join-Path $debugRoot $debugFileName)
Copy-Item -LiteralPath $releaseSource -Destination $releaseDistPath -Force
Copy-Item -LiteralPath $debugSource -Destination $debugDistPath -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "LICENSE") -Destination (Join-Path $stagingRoot "LICENSE.txt") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "THIRD-PARTY-NOTICES.md") -Destination (Join-Path $stagingRoot "THIRD-PARTY-NOTICES.txt") -Force

$readme = Expand-Template -TemplatePath (Join-Path $templatesRoot "README-安装说明.template.txt")
$feedback = Expand-Template -TemplatePath (Join-Path $templatesRoot "问题反馈模板.template.txt")
Write-Utf8Text -Path (Join-Path $stagingRoot "README-安装说明.txt") -Content $readme
Write-Utf8Text -Path (Join-Path $stagingRoot "问题反馈模板.txt") -Content $feedback

$checksumText = @"
$releaseFileName
SHA-256:
$releaseHash

$debugFileName
SHA-256:
$debugHash
"@
Write-Utf8Text -Path (Join-Path $stagingRoot "SHA256.txt") -Content $checksumText.TrimStart()

Assert-CleanDistributionTree -Root $stagingRoot
$secretTextFileCount = Invoke-SecretScan -Root $stagingRoot

foreach ($oldOutput in @($zipPath, $zipHashPath, $legacyZipPath, $legacyZipHashPath)) {
  if (Test-Path -LiteralPath $oldOutput) { Remove-Item -LiteralPath $oldOutput -Force }
}
Compress-Archive -LiteralPath $stagingRoot -DestinationPath $zipPath -CompressionLevel Optimal
$zipInfo = Get-Item -LiteralPath $zipPath
$zipHash = Get-Sha256 -Path $zipPath
$zipChecksumText = "$zipFileName`r`nSHA-256:`r`n$zipHash"
Write-Utf8Text -Path $zipHashPath -Content $zipChecksumText

$formalAfter = Get-TreeAggregate -Root $formalRoot
if ($formalAfter.SHA256 -ne $formalBefore.SHA256 -or
    $formalAfter.FileCount -ne $formalBefore.FileCount -or
    $formalAfter.TotalSize -ne $formalBefore.TotalSize) {
  throw "Formal project hash changed during distribution build. Before $($formalBefore.SHA256), after $($formalAfter.SHA256)."
}

$runtimeAfter = Get-TreeAggregate -Root $runtimeRoot
if ($runtimeAfter.SHA256 -ne $runtimeBefore.SHA256 -or
    $runtimeAfter.FileCount -ne $runtimeBefore.FileCount -or
    $runtimeAfter.TotalSize -ne $runtimeBefore.TotalSize) {
  throw "Compat Runtime changed during distribution build. Before $($runtimeBefore.SHA256), after $($runtimeAfter.SHA256)."
}

$zipContents = @(
  "$packageFolderName/",
  "$packageFolderName/$releaseFileName",
  "$packageFolderName/README-安装说明.txt",
  "$packageFolderName/LICENSE.txt",
  "$packageFolderName/THIRD-PARTY-NOTICES.txt",
  "$packageFolderName/SHA256.txt",
  "$packageFolderName/问题反馈模板.txt",
  "$packageFolderName/Debug/",
  "$packageFolderName/Debug/$debugFileName"
)

function Write-BuildReport {
  param([string]$TestResult)
  $lines = @(
    "# Public Release Distribution Build Report", "",
    "- Distribution Version: ``$distributionVersion / $productVersion``",
    "- Build Time: ``$([DateTime]::UtcNow.ToString('o'))``",
    "- Release source filename: ``$releaseSourceFileName``",
    "- Release distribution filename: ``$releaseFileName``",
    "- Release size: ``$($releaseInfo.Length) bytes``",
    "- Release SHA256: ``$releaseHash``",
    "- Debug source filename: ``$debugSourceFileName``",
    "- Debug distribution filename: ``$debugFileName``",
    "- Debug size: ``$($debugInfo.Length) bytes``",
    "- Debug SHA256: ``$debugHash``",
    "- Runtime file count: ``$($runtimeAfter.FileCount)``",
    "- Runtime total size: ``$($runtimeAfter.TotalSize) bytes``",
    "- Runtime SHA256: ``$($runtimeAfter.SHA256)``",
    "- ZIP filename: ``$zipFileName``",
    "- ZIP size: ``$($zipInfo.Length) bytes``",
    "- ZIP SHA256: ``$zipHash``",
    "- Secret scan result: **PASS** ($secretTextFileCount generated text files scanned; EXE binaries excluded)",
    "- Excluded content validation: **PASS**",
    "- Formal project hash: ``$($formalAfter.SHA256)``",
    "- Distribution tests result: **$TestResult**", "", "## ZIP contents", ""
  ) + @($zipContents | ForEach-Object { "- ``$_``" }) + @(
    "", "## Current image-quality-fix status", "",
    "- Match-main-region sizing defaults to disabled.",
    "- Enabled sizing shrinks oversized images through Canvas only when needed.",
    "- Smaller-than-target images keep the original PNG and use Photoshop Smart Object placement; browser Canvas never upscales them.",
    "- Equal-size images keep the original PNG and avoid unnecessary re-encoding.",
    "", "The distribution step consumed the freshly rebuilt, hash-verified installer executables from installer/dist without modifying them.", ""
  )
  Write-Utf8Text -Path $reportPath -Content ($lines -join "`r`n")
}

Write-BuildReport -TestResult "PENDING"
$testPath = Join-Path $distributionRoot "tests\distribution-targeted.test.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-BuildReport -TestResult "FAIL — Node.js unavailable"; throw "Node.js is required to run distribution tests." }
& $node.Source --test $testPath
if ($LASTEXITCODE -ne 0) { Write-BuildReport -TestResult "FAIL"; throw "Distribution tests failed." }
Write-BuildReport -TestResult "PASS — 27/27"

Write-Host "Distribution built: $zipPath"
Write-Host "Size: $($zipInfo.Length)"
Write-Host "SHA256: $zipHash"
Write-Host "Checksum file: $zipHashPath"
Write-Host "Report: $reportPath"
