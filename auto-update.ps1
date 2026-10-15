# OviPets Full Extension updater for Windows PowerShell 5.1.
# Stable main only. Apply only when Edge/Chrome/Brave is completely closed.
# Verifies exact main commit has passed Extension CI. Backs up, installs manifest last.
param([switch]$CheckOnly, [switch]$Rollback)
$ErrorActionPreference = "Stop"
$Repo = "ngotrongduong/ovipet"
$Branch = "main"
$ExpectedName = "OviPets Hatchery Helper"
$target = $PSScriptRoot
$logFile = Join-Path $target "auto-update.log"
$checkFile = Join-Path $target "auto-update-last-check.txt"
$backupDir = Join-Path $target ".oweh-full-update-backup"
$lockPath = Join-Path $target "auto-update.lock"
$allowedDirs = @("bg","core","data","dom","domain","features","jobs","services","ui","review")
$allowedFiles = @("background.js","content.js","content.css","offscreen.html","offscreen.js","page-bridge.js")
$allowedExt = @(".js",".json",".css",".html",".png",".jpg",".jpeg",".svg",".ico",".webp")
$work = $null
$handle = $null
$outcome = "not started"
$failed = $false

function Write-Log([string]$entry) {
  try {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $entry
    $kept = @()
    if (Test-Path -LiteralPath $logFile) { $kept = @(Get-Content -LiteralPath $logFile -Tail 149) }
    Set-Content -LiteralPath $logFile -Value ($kept + $line) -Encoding UTF8
  } catch {}
}
function Read-Manifest([string]$dir) {
  $file = Join-Path $dir "manifest.json"
  if (-not (Test-Path -LiteralPath $file)) { throw "manifest.json not found in $dir" }
  $m = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($m.name -ne $ExpectedName -or [int]$m.manifest_version -ne 3) {
    throw "Wrong extension: expected $ExpectedName (Manifest V3)"
  }
  if ("$($m.version)" -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid manifest version" }
  return $m
}
function Assert-Relative([string]$name) {
  if ([string]::IsNullOrWhiteSpace($name) -or $name.StartsWith("/") -or
      $name.StartsWith("\") -or $name.Contains(":") -or
      $name -match '(^|[\\/])\.\.?([\\/]|$)') { throw "Unsafe relative path: $name" }
}
function Browser-Running {
  # Conservative: even a background Edge process can hold the loaded unpacked extension.
  foreach ($name in @("msedge","chrome","brave")) {
    if (@(Get-Process -Name $name -ErrorAction SilentlyContinue).Count -gt 0) { return $true }
  }
  return $false
}
function Restore-Backup([string]$snapshot) {
  if (-not (Test-Path -LiteralPath (Join-Path $snapshot "manifest.json"))) { throw "Backup missing manifest.json" }
  $newList = Join-Path $snapshot "new-files.txt"
  if (Test-Path -LiteralPath $newList) {
    foreach ($relative in @(Get-Content -LiteralPath $newList)) {
      if (-not $relative) { continue }
      Assert-Relative $relative
      if ($relative -eq "manifest.json" -or $relative -eq "auto-update.ps1") { throw "Invalid backup metadata" }
      $dest = Join-Path $target $relative
      if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
    }
  }
  $root = (Resolve-Path -LiteralPath $snapshot).Path.TrimEnd('\')
  foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -File) {
    $relative = $file.FullName.Substring($root.Length).TrimStart('\')
    if (@("new-files.txt","snapshot-info.txt","manifest.json") -contains $relative) { continue }
    Assert-Relative $relative
    $dest = Join-Path $target $relative
    $dir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Copy-Item -LiteralPath $file.FullName -Destination $dest -Force
  }
  Copy-Item -LiteralPath (Join-Path $snapshot "manifest.json") -Destination (Join-Path $target "manifest.json") -Force
}
function Assert-Candidate([string]$dir, $m) {
  $needed = @("background.js","content.js","content.css","page-bridge.js","offscreen.html","offscreen.js","ui/panel.js")
  $needed += @($m.background.service_worker)
  foreach ($entry in @($m.content_scripts)) { $needed += @($entry.js) + @($entry.css) }
  $bg = Get-Content -LiteralPath (Join-Path $dir "background.js") -Raw -Encoding UTF8
  $imports = [regex]::Match($bg, 'importScripts\(([\s\S]*?)\);')
  if (-not $imports.Success) { throw "Background import list missing" }
  foreach ($match in [regex]::Matches($imports.Groups[1].Value, '["'']([^"'']+\.js)["'']')) {
    $needed += $match.Groups[1].Value
  }
  foreach ($name in $needed) {
    Assert-Relative $name
    if (-not (Test-Path -LiteralPath (Join-Path $dir $name))) { throw "Missing runtime file: $name" }
  }
  $panel = Get-Content -LiteralPath (Join-Path $dir "ui/panel.js") -Raw -Encoding UTF8
  if (-not $panel.Contains('class="oweh-version">v' + $m.version + '</span>')) { throw "Panel version mismatch" }
  $readme = Get-Content -LiteralPath (Join-Path $dir "README.md") -Raw -Encoding UTF8
  if (-not $readme.Contains('Current release: **v' + $m.version + '**')) { throw "README version mismatch" }
}
function Allowed-Runtime([string]$relative) {
  Assert-Relative $relative
  if ($relative -eq "manifest.json") { return $false }
  if ($relative -notmatch '[\\/]' -and $allowedFiles -contains $relative) { return $true }
  $parts = $relative -split '[\\/]'
  return $parts.Length -ge 2 -and $allowedDirs -contains $parts[0] -and
    $allowedExt -contains [IO.Path]::GetExtension($relative).ToLowerInvariant()
}

try {
  # Same-directory exclusive file lock prevents overlapping scheduled/manual invocations.
  $handle = [IO.File]::Open($lockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  $local = Read-Manifest $target
  if ($Rollback) {
    if (Browser-Running) { throw "Close Edge and Chrome before restoring a backup" }
    if (-not (Test-Path -LiteralPath $backupDir)) { throw "No previous-version backup exists" }
    Restore-Backup $backupDir
    $after = Read-Manifest $target
    $outcome = "restored v$($local.version) -> v$($after.version); restart Edge"
    Write-Log $outcome
  } else {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $client = New-Object Net.WebClient
    $client.Headers["User-Agent"] = "OviPets-Full-AutoUpdater/1.0"
    $nonce = [DateTime]::UtcNow.Ticks
    $remote = $client.DownloadString("https://raw.githubusercontent.com/$Repo/$Branch/manifest.json?t=$nonce") | ConvertFrom-Json
    if ($remote.name -ne $ExpectedName -or "$($remote.version)" -notmatch '^\d+\.\d+\.\d+$') {
      throw "Untrusted remote manifest"
    }
    if ([version]$remote.version -le [version]$local.version) {
      $outcome = "up to date (v$($local.version))"
    } else {
      $head = $client.DownloadString("https://api.github.com/repos/$Repo/commits/$Branch") | ConvertFrom-Json
      $sha = [string]$head.sha
      if ($sha -notmatch '^[a-f0-9]{40}$') { throw "Invalid main commit SHA" }
      $runs = $client.DownloadString("https://api.github.com/repos/$Repo/actions/workflows/ci.yml/runs?branch=main&per_page=25") | ConvertFrom-Json
      $green = @($runs.workflow_runs | Where-Object {
        $_.head_sha -eq $sha -and $_.event -eq "push" -and
        $_.status -eq "completed" -and $_.conclusion -eq "success"
      })
      if ($green.Count -eq 0) {
        $outcome = "waiting for green Extension CI on main $($sha.Substring(0,12))"
      } elseif (Browser-Running) {
        $outcome = "v$($remote.version) available; waiting for Edge/Chrome to close"
      } elseif ($CheckOnly) {
        $outcome = "verified update available: v$($remote.version) at $($sha.Substring(0,12)) (dry run)"
      } else {
        $work = Join-Path ([IO.Path]::GetTempPath()) ("oweh-full-update-" + [Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Path $work | Out-Null
        $zip = Join-Path $work "source.zip"
        $client.DownloadFile("https://codeload.github.com/$Repo/zip/$sha", $zip)
        if ((Get-Item -LiteralPath $zip).Length -gt 75000000) { throw "Archive larger than 75MB" }
        $unpacked = Join-Path $work "unpacked"
        Expand-Archive -LiteralPath $zip -DestinationPath $unpacked
        $candidateRoot = Get-ChildItem -LiteralPath $unpacked -Directory | Where-Object {
          Test-Path -LiteralPath (Join-Path $_.FullName "manifest.json")
        } | Select-Object -First 1
        if (-not $candidateRoot) { throw "Pinned commit lacks extension manifest" }
        $new = Read-Manifest $candidateRoot.FullName
        if ([version]$new.version -le [version]$local.version) { throw "Pinned commit is not newer" }
        Assert-Candidate $candidateRoot.FullName $new
        if (Browser-Running) { throw "Browser reopened during staging; run deferred" }

        $root = (Resolve-Path -LiteralPath $candidateRoot.FullName).Path.TrimEnd('\')
        $copyList = @()
        foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -File) {
          $relative = $file.FullName.Substring($root.Length).TrimStart('\')
          if (Allowed-Runtime $relative) { $copyList += $relative }
        }
        if ($copyList.Count -lt 20) { throw "Too few files in staged runtime" }
        $snapshot = Join-Path $work "snapshot"
        New-Item -ItemType Directory -Path $snapshot | Out-Null
        $newFiles = @()
        foreach ($relative in @($copyList + "manifest.json")) {
          $current = Join-Path $target $relative
          $saved = Join-Path $snapshot $relative
          if (Test-Path -LiteralPath $current) {
            $dir = Split-Path -Parent $saved
            if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            Copy-Item -LiteralPath $current -Destination $saved -Force
          } else { $newFiles += $relative }
        }
        Set-Content -LiteralPath (Join-Path $snapshot "new-files.txt") -Value $newFiles -Encoding UTF8
        Set-Content -LiteralPath (Join-Path $snapshot "snapshot-info.txt") -Value ("before=v{0}; after=v{1}; commit={2}" -f $local.version,$new.version,$sha) -Encoding UTF8
        if (-not (Test-Path -LiteralPath (Join-Path $snapshot "manifest.json"))) { throw "Cannot back up manifest" }
        $olderBackup = "$backupDir.previous"
        if (Test-Path -LiteralPath $olderBackup) { Remove-Item -LiteralPath $olderBackup -Recurse -Force }
        if (Test-Path -LiteralPath $backupDir) { Move-Item -LiteralPath $backupDir -Destination $olderBackup }
        Move-Item -LiteralPath $snapshot -Destination $backupDir
        try {
          foreach ($relative in $copyList) {
            if (Browser-Running) { throw "Browser started during installation; rolling back" }
            $dest = Join-Path $target $relative
            $dir = Split-Path -Parent $dest
            if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            Copy-Item -LiteralPath (Join-Path $root $relative) -Destination $dest -Force
          }
          if (Browser-Running) { throw "Browser started before manifest switch; rolling back" }
          Copy-Item -LiteralPath (Join-Path $root "manifest.json") -Destination (Join-Path $target "manifest.json") -Force
          if ((Read-Manifest $target).version -ne $new.version) { throw "Final manifest validation failed" }
          $outcome = "updated v$($local.version) -> v$($new.version) from green main $($sha.Substring(0,12)); reopen Edge"
          Write-Log $outcome
          if (Test-Path -LiteralPath $olderBackup) { Remove-Item -LiteralPath $olderBackup -Recurse -Force }
        } catch {
          Restore-Backup $backupDir
          Write-Log "Failed update restored old v$($local.version)"
          throw
        }
      }
    }
  }
} catch {
  $outcome = "failed: $($_.Exception.Message)"
  Write-Log $outcome
  $failed = $true
} finally {
  if ($work -and (Test-Path -LiteralPath $work)) {
    try { Remove-Item -LiteralPath $work -Recurse -Force } catch {}
  }
  if ($handle) { $handle.Dispose() }
  try {
    Set-Content -LiteralPath $checkFile -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"),$outcome) -Encoding UTF8
  } catch {}
}
Write-Output $outcome
if ($failed) { exit 1 }
