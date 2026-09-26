Set-StrictMode -Version Latest

function Get-FileVersionSafe {
  param([string]$Path)
  try { return (Get-Item -LiteralPath $Path -ErrorAction Stop).VersionInfo.FileVersion }
  catch { return $null }
}

function Add-PhotoshopCandidate {
  param([System.Collections.Generic.List[object]]$List, [System.Collections.Generic.HashSet[string]]$Seen, [string]$ExePath, [string]$Source)
  if (-not $ExePath) { return }
  $full = [System.IO.Path]::GetFullPath($ExePath)
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return }
  if (-not $Seen.Add($full.ToLowerInvariant())) { return }
  $version = Get-FileVersionSafe -Path $full
  $major = $null
  if ($version -match '^(\d+)') { $major = [int]$Matches[1] }
  $year = switch ($major) { 23 { 2022 } 24 { 2023 } 25 { 2024 } 26 { 2025 } default { $null } }
  $displayName = if ($year) { "Photoshop $year" } else { "Photoshop" }
  $displayVersion = if ($version) { $version } else { 'unknown' }
  $status = if ($major -in @(23,24,25)) { 'Supported' } else { 'Not Targeted' }
  $List.Add([pscustomobject]@{ Name = $displayName; Version = $displayVersion; Major = $major; Path = $full; Status = $status; Source = $Source })
}

function Get-PhotoshopDetections {
  $results = [System.Collections.Generic.List[object]]::new()
  $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $registryRoots = @('HKLM:\SOFTWARE\Adobe\Photoshop', 'HKLM:\SOFTWARE\WOW6432Node\Adobe\Photoshop', 'HKCU:\SOFTWARE\Adobe\Photoshop')
  foreach ($root in $registryRoots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
      $properties = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
      foreach ($property in @('ApplicationPath','Path','InstallPath')) {
        $member = $properties.PSObject.Properties[$property]
        $value = if ($member) { $member.Value } else { $null }
        if ($value) { Add-PhotoshopCandidate -List $results -Seen $seen -ExePath ([System.IO.Path]::Combine([string]$value, 'Photoshop.exe')) -Source "Registry:$($key.Name)" }
      }
    }
  }
  $adobeRoots = @()
  if (${env:ProgramFiles}) { $adobeRoots += (Join-Path ${env:ProgramFiles} 'Adobe') }
  if (${env:ProgramFiles(x86)}) { $adobeRoots += (Join-Path ${env:ProgramFiles(x86)} 'Adobe') }
  foreach ($root in $adobeRoots | Select-Object -Unique) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    Get-ChildItem -LiteralPath $root -Directory -Filter '*Photoshop*' -ErrorAction SilentlyContinue | ForEach-Object {
      Add-PhotoshopCandidate -List $results -Seen $seen -ExePath (Join-Path $_.FullName 'Photoshop.exe') -Source 'CommonPath'
    }
  }
  return @($results | Sort-Object Major, Path)
}

function Get-CSXSStatus {
  $root = 'HKCU:\Software\Adobe'
  if (-not (Test-Path -LiteralPath $root)) { return @() }
  $items = @()
  foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^CSXS\.\d+$' }) {
    $properties = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
    $member = if ($properties) { $properties.PSObject.Properties['PlayerDebugMode'] } else { $null }
    $value = if ($member) { $member.Value } else { $null }
    $items += [pscustomobject]@{ Name = $key.PSChildName; RegistryPath = $key.PSPath; PlayerDebugMode = $value; Enabled = [string]$value -eq '1' }
  }
  return $items | Sort-Object Name
}

function Enable-DetectedCSXSDebugMode {
  param([object[]]$Statuses, [switch]$ExplicitlyApproved)
  if (-not $ExplicitlyApproved) { return @() }
  $changed = @()
  foreach ($item in $Statuses) {
    if (-not $item.RegistryPath -or -not (Test-Path -LiteralPath $item.RegistryPath)) { continue }
    New-ItemProperty -LiteralPath $item.RegistryPath -Name PlayerDebugMode -Value '1' -PropertyType String -Force -ErrorAction Stop | Out-Null
    $changed += $item.Name
  }
  return $changed
}

function Get-PersistedInstallLocation {
  $key = 'HKCU:\Software\PSAIImageHubCompatInstaller'
  if (-not (Test-Path -LiteralPath $key)) { return $null }
  $properties = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
  if (-not $properties) { return $null }
  function Read-RegistryValue([string]$Name) { $member=$properties.PSObject.Properties[$Name]; if($member){return [string]$member.Value}; return $null }
  return [pscustomobject]@{ InstallRoot=(Read-RegistryValue 'InstallRoot'); InstallPath=(Read-RegistryValue 'InstallPath'); InstalledVersion=(Read-RegistryValue 'InstalledVersion') }
}

function Set-PersistedInstallLocation {
  param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$InstallPath,[Parameter(Mandatory=$true)][string]$InstalledVersion)
  $key = 'HKCU:\Software\PSAIImageHubCompatInstaller'
  New-Item -Path $key -Force | Out-Null
  New-ItemProperty -LiteralPath $key -Name InstallRoot -Value $InstallRoot -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $key -Name InstallPath -Value $InstallPath -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $key -Name InstalledVersion -Value $InstalledVersion -PropertyType String -Force | Out-Null
}

function Clear-PersistedInstallLocation {
  Remove-Item -LiteralPath 'HKCU:\Software\PSAIImageHubCompatInstaller' -Recurse -Force -ErrorAction SilentlyContinue
}

Export-ModuleMember -Function Get-PhotoshopDetections,Get-CSXSStatus,Enable-DetectedCSXSDebugMode,Get-PersistedInstallLocation,Set-PersistedInstallLocation,Clear-PersistedInstallLocation
