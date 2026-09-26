$ErrorActionPreference = 'Stop'
$installerRoot = Split-Path -Parent $PSScriptRoot
Import-Module (Join-Path $installerRoot 'src\registryDetector.psm1') -Force
$detections = @(Get-PhotoshopDetections)
$csxs = @(Get-CSXSStatus)
$lines = @('# Photoshop Detection Report','',("- Detection time: {0}" -f (Get-Date -Format o)),'- Operation: read-only','')
if ($detections.Count -eq 0) { $lines += 'No Photoshop installation was detected in reliable registry entries or standard Adobe installation paths.' }
else {
  foreach ($item in $detections) {
    $lines += "## $($item.Name)"
    $lines += ''
    $lines += "- Version: $($item.Version)"
    $lines += "- Path: $($item.Path)"
    $lines += "- Status: $($item.Status)"
    $lines += "- Source: $($item.Source)"
    $lines += ''
  }
}
$lines += @('## CEP / CSXS PlayerDebugMode','')
if ($csxs.Count -eq 0) { $lines += '- No existing HKCU CSXS keys detected.' }
else { foreach ($item in $csxs) { $lines += "- $($item.Name): " + $(if($item.Enabled){'Enabled'}else{'Disabled / not set'}) } }
$lines += @('','No registry values were changed. No Photoshop files were modified.','')
$report = Join-Path $installerRoot 'reports\PHOTOSHOP_DETECTION_REPORT.md'
New-Item -ItemType Directory -Path (Split-Path -Parent $report) -Force | Out-Null
$lines | Set-Content -LiteralPath $report -Encoding UTF8
Write-Output "Detection report: $report"
$detections | Format-Table Name,Version,Status,Path -AutoSize
