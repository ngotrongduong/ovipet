# Friend Sweep Lite updater.
#
# Copies a newer release of this extension from GitHub into the folder this script lies in.
# The extension then notices the new version in its folder and reloads itself in a quiet moment
# (bg/self-update.js), so nothing has to be clicked.
#
# Started every 30 minutes by the scheduled task that "Enable auto-update.bat" creates.
# Safe by construction:
#   - it only ever runs inside a folder whose manifest.json is this extension's;
#   - it copies files in, it never deletes anything in this folder;
#   - only the kinds of file an extension is made of are copied (see $Allowed); scripts and
#     programs in the download never are, so what the scheduled task runs can not be replaced
#     from the internet;
#   - a download that is not a complete, newer release of this extension is thrown away;
#   - manifest.json is copied last: its version is the "release is complete" signal.
#
# auto-update-last-check.txt holds the time and outcome of the last run; auto-update.log the
# last 200 updates and failures.
param(
  [string]$Repo = "ngotrongduong/ovipet",
  [string]$Branch = "main",
  [string]$Subfolder = "friend-sweep-lite",
  [string]$ExpectedName = "OviPets Friend Sweep Lite"
)

$ErrorActionPreference = "Stop"
$Allowed = @(".js", ".json", ".css", ".html", ".md", ".txt", ".png", ".jpg", ".svg", ".ico", ".webp")
$Own = @("manifest.json", "auto-update.log", "auto-update-last-check.txt")
$target = $PSScriptRoot
$logFile = Join-Path $target "auto-update.log"
$checkFile = Join-Path $target "auto-update-last-check.txt"

function Write-Log([string]$text) {
  try {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $text
    $kept = @()
    if (Test-Path -LiteralPath $logFile) { $kept = @(Get-Content -LiteralPath $logFile -Tail 199) }
    Set-Content -LiteralPath $logFile -Value ($kept + $line) -Encoding UTF8
  } catch {}
}

$work = $null
$outcome = "failed"
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $manifestPath = Join-Path $target "manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath)) { throw "no manifest.json next to this script: it must stay inside the extension folder" }
  $local = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($local.name -ne $ExpectedName) { throw "this folder holds '$($local.name)', not '$ExpectedName'" }

  $client = New-Object Net.WebClient
  $client.Headers["User-Agent"] = "oweh-lite-updater"
  $stamp = [DateTime]::UtcNow.Ticks
  $remote = $client.DownloadString("https://raw.githubusercontent.com/$Repo/$Branch/$Subfolder/manifest.json?t=$stamp") | ConvertFrom-Json
  if ([version]$remote.version -le [version]$local.version) {
    $outcome = "up to date (v$($local.version))"
  } else {
    $work = Join-Path ([IO.Path]::GetTempPath()) ("oweh-lite-update-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $work | Out-Null
    $zip = Join-Path $work "release.zip"
    $client.DownloadFile("https://github.com/$Repo/archive/refs/heads/$Branch.zip", $zip)
    Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $work "unpacked")
    $new = Get-ChildItem -LiteralPath (Join-Path $work "unpacked") -Directory |
      ForEach-Object { Join-Path $_.FullName $Subfolder } |
      Where-Object { Test-Path -LiteralPath (Join-Path $_ "manifest.json") } | Select-Object -First 1
    if (-not $new) { throw "the download does not contain $Subfolder/manifest.json" }

    $manifest = Get-Content -LiteralPath (Join-Path $new "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.name -ne $ExpectedName) { throw "the download holds '$($manifest.name)'" }
    if ([version]$manifest.version -le [version]$local.version) { throw "the download ($($manifest.version)) is not newer than $($local.version)" }
    $needed = @($manifest.background.service_worker)
    foreach ($entry in @($manifest.content_scripts)) { $needed += @($entry.js) + @($entry.css) }
    foreach ($file in $needed) {
      if ($file -and -not (Test-Path -LiteralPath (Join-Path $new $file))) { throw "the download lacks $file" }
    }

    $root = (Resolve-Path -LiteralPath $new).Path.TrimEnd('\')
    $copied = 0
    foreach ($item in Get-ChildItem -LiteralPath $root -Recurse -File) {
      $relative = $item.FullName.Substring($root.Length).TrimStart('\')
      if ($Own -contains $relative) { continue }
      if ($Allowed -notcontains $item.Extension.ToLowerInvariant()) { continue }
      $destination = Join-Path $target $relative
      $folder = Split-Path -Parent $destination
      if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
      Copy-Item -LiteralPath $item.FullName -Destination $destination -Force
      $copied += 1
    }
    Copy-Item -LiteralPath (Join-Path $root "manifest.json") -Destination $manifestPath -Force
    $outcome = "updated v$($local.version) -> v$($manifest.version) ($copied files); the extension reloads itself when it is idle"
    Write-Log $outcome
  }
} catch {
  $outcome = "failed: $($_.Exception.Message)"
  Write-Log "update $outcome"
} finally {
  if ($work -and (Test-Path -LiteralPath $work)) {
    try { Remove-Item -LiteralPath $work -Recurse -Force } catch {}
  }
  try {
    Set-Content -LiteralPath $checkFile -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $outcome) -Encoding UTF8
  } catch {}
}
