# Install / uninstall dsh-find-file for one DSH profile.
#
#   pwsh -File install.ps1              install into the desktop profile
#   pwsh -File install.ps1 -Uninstall   remove the plugin row and the junction
#   pwsh -File install.ps1 -Profile web install into another profile
#   pwsh -File install.ps1 -DshHome X   use another DSH home (testing)
#
# What it changes (nothing else):
#   <dsh home>/profiles/<profile>/cordis.patch.yml
#       one `- insert:` entry with id find-file (config: maxResults,
#       timeBudgetMs, maxDepth, includeDirs)
#   <dsh home>/profiles/<profile>/node_modules/dsh-find-file
#       directory junction to this folder
# A timestamped backup of cordis.patch.yml is written before every edit;
# -Uninstall removes the row with the same algorithm that added it, and the
# backup can be restored byte for byte if anything looks off.
# The patch row below is fixed and pre-validated, so no YAML re-parse runs
# here (this repo ships no patch-check tool).
[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$pluginDir = $PSScriptRoot
$profileDir = Join-Path $DshHome "profiles\$Profile"
$patchFile = Join-Path $profileDir 'cordis.patch.yml'

$manifestPath = Join-Path $pluginDir 'package.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "package.json not found next to install.ps1: $manifestPath" }
$packageName = (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).name
if ([string]::IsNullOrWhiteSpace($packageName) -or $packageName -notmatch '^(@[a-z0-9-~][a-z0-9-._~]*/)?[a-z0-9-~][a-z0-9-._~]*$') {
  throw "package.json has an unusable package name: '$packageName'"
}
$leafName = $packageName -replace '^@[^/]+/', ''
if ((Split-Path -Leaf $pluginDir) -ne $leafName) {
  Write-Warning "folder name does not match the package name ($packageName); the junction is named after the package, which is what the loader resolves"
}
$junction = Join-Path $profileDir "node_modules\$leafName"

if (-not (Test-Path -LiteralPath $profileDir)) { throw "profile not found: $profileDir" }
if (-not (Test-Path -LiteralPath $patchFile)) { throw "cordis.patch.yml not found: $patchFile" }

function Get-Ending([string]$text) {
  # Preserve the file's own dominant line ending.
  $crlf = ([regex]::Matches($text, "`r`n")).Count
  $lf = ([regex]::Matches($text, "(?<!`r)`n")).Count
  if ($crlf -gt $lf) { return "`r`n" }
  return "`n"
}

function Remove-PluginRow([string]$text, [string]$ending) {
  # Drop the comment + `- insert:` block that carries our id/name, and nothing
  # else. The patch layer is a hand-written YAML list: a block runs from the
  # comment directly above its `- insert:` line down to the last line indented
  # deeper than that entry, so the next top-level entry (column 0) ends it.
  $lines = $text -split "`r?`n"
  $kept = New-Object System.Collections.Generic.List[string]
  $skipping = $false
  $entryIndent = 0
  $removedLines = 0
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($skipping) {
      $indent = $line.Length - $line.TrimStart().Length
      if ($line.Trim() -eq '' -or $indent -gt $entryIndent) { $removedLines++; continue }
      $skipping = $false
    }
    if ($line -match '^\s*-\s*insert:\s*$') {
      $lookahead = $lines[$i..([Math]::Min($i + 3, $lines.Count - 1))] -join "`n"
      if ($lookahead -match 'dsh-find-file|id:\s*find-file') {
        Write-Output ('found the find-file insert block at line ' + ($i + 1))
        while ($kept.Count -gt 0 -and ($kept[$kept.Count - 1].TrimStart().StartsWith('#') -or $kept[$kept.Count - 1].Trim() -eq '')) {
          $kept.RemoveAt($kept.Count - 1)
          $removedLines++
        }
        $entryIndent = $line.Length - $line.TrimStart().Length
        $skipping = $true
        $removedLines++
        continue
      }
    }
    $kept.Add($line)
  }
  return @{ Text = (($kept -join $ending).TrimEnd() + $ending); RemovedLines = $removedLines }
}

# Read/write the layer as UTF-8 explicitly: Windows PowerShell 5.1 would
# otherwise decode the profile layer with the ANSI code page.
function Read-Utf8([string]$path) {
  return [IO.File]::ReadAllText($path, (New-Object Text.UTF8Encoding($false)))
}
function Write-Utf8([string]$path, [string]$text) {
  [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

if ($Uninstall) {
  $before = Read-Utf8 $patchFile
  $result = Remove-PluginRow $before (Get-Ending $before)
  if ($result.RemovedLines -gt 0) {
    Copy-Item -LiteralPath $patchFile -Destination "$patchFile.bak-uninstall-$(Get-Date -Format yyyyMMdd-HHmmss)" -Force
    Write-Utf8 $patchFile $result.Text
    Write-Output ("removed the find-file row (" + $result.RemovedLines + " lines) from $patchFile")
  } else {
    Write-Output "no find-file row found in $patchFile (nothing to do)"
  }
  if (Test-Path -LiteralPath $junction) {
    $item = Get-Item -LiteralPath $junction -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      [IO.Directory]::Delete($junction)
      Write-Output "removed junction $junction"
    } else {
      Write-Output "left $junction alone: it is a real directory, not a junction"
    }
  }
  Write-Output 'Restart DSH to unload the plugin.'
  exit 0
}

# 1. Link the package so the profile loader can resolve the name.
New-Item -ItemType Directory -Path (Join-Path $profileDir 'node_modules') -Force | Out-Null
$existing = Get-Item -LiteralPath $junction -Force -ErrorAction SilentlyContinue
if ($existing) {
  if (-not ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "$junction exists and is not a junction; remove it yourself if it is a stale copy"
  }
  # PS 5.1 reports a junction target with a device prefix ("\??\", "Global\")
  # and the repo path may carry a trailing backslash; normalize both to the
  # bare drive path so a second run recognizes its own junction.
  $target = (Get-Item -LiteralPath $junction -Force).Target
  $target = [string]$target -replace '^.*?([A-Za-z]:\\)', '$1'
  if (($target.TrimEnd('\')) -ne ($pluginDir.TrimEnd('\'))) {
    [IO.Directory]::Delete($junction)
    New-Item -ItemType Junction -Path $junction -Target $pluginDir | Out-Null
    Write-Output "repointed junction to $pluginDir"
  } else {
    Write-Output "junction already points at $pluginDir"
  }
} else {
  New-Item -ItemType Junction -Path $junction -Target $pluginDir | Out-Null
  Write-Output "linked $junction -> $pluginDir"
}

# 2. Add the plugin row to the profile patch layer (idempotent).
$text = Read-Utf8 $patchFile
if ($text -match 'id:\s*find-file') {
  Write-Output 'plugin row already present in cordis.patch.yml'
} else {
  Copy-Item -LiteralPath $patchFile -Destination "$patchFile.bak-find-file-$(Get-Date -Format yyyyMMdd-HHmmss)" -Force
  $block = @(
    '',
    '# find_file: permission-wall-immune file search (agent tool)',
    '- insert:',
    '    - id: find-file',
    "      name: `"$packageName`"",
    '      config:',
    '        maxResults: 50',
    '        timeBudgetMs: 90000',
    '        maxDepth: 64',
    '        includeDirs: false'
  ) -join "`r`n"
  $ending = Get-Ending $text
  $block = $block -replace "`r`n", $ending
  Write-Utf8 $patchFile ($text.TrimEnd() + $ending + $block + $ending)
  Write-Output "added the find-file row to $patchFile"
}

Write-Output ''
Write-Output 'Done. Restart DSH, then the agent can call find_file; check Settings -> Plugins'
Write-Output 'to confirm dsh-find-file is enabled.'
