$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot "outputs\dev\PS-AI-Image-Hub-CEP11-Compat"
$destination = Join-Path $env:APPDATA "Adobe\CEP\extensions\PS-AI-Image-Hub-CEP11-Compat"
$expectedDestination = [System.IO.Path]::GetFullPath((Join-Path $env:APPDATA "Adobe\CEP\extensions\PS-AI-Image-Hub-CEP11-Compat"))
$resolvedDestination = [System.IO.Path]::GetFullPath($destination)

if (-not (Test-Path -LiteralPath (Join-Path $source "CSXS\manifest.xml"))) {
  throw "Build the dev staging directory before installation."
}
if ($resolvedDestination -ne $expectedDestination -or (Split-Path -Leaf $resolvedDestination) -ne "PS-AI-Image-Hub-CEP11-Compat") {
  throw "Refusing to install outside the exact compat extension directory."
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-ChildItem -LiteralPath $destination -Force | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $destination -Recurse -Force
Write-Output "Installed PS AI Image Hub CEP11 build to: $destination"
