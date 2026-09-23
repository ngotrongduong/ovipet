$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root
try {
    Write-Host "== OviPets RC automated gates ==" -ForegroundColor Cyan
    node scripts/verify-js.js
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax gate failed" }

    node scripts/verify-release.js
    if ($LASTEXITCODE -ne 0) { throw "Release consistency gate failed" }

    node --test tests/*.test.js
    if ($LASTEXITCODE -ne 0) { throw "Node regression suite failed" }

    # Prefer Microsoft Edge because it is the supported Windows target for this project.
    # Wrap the pipeline in @() so one match still behaves as an array.
    $browserCandidates = @(
        @(
            @{ Name = "Microsoft Edge"; Path = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" },
            @{ Name = "Microsoft Edge"; Path = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" },
            @{ Name = "Microsoft Edge"; Path = "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe" },
            @{ Name = "Google Chrome"; Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" },
            @{ Name = "Google Chrome"; Path = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe" },
            @{ Name = "Google Chrome"; Path = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe" }
        ) | Where-Object { $_.Path -and (Test-Path $_.Path) }
    )

    if ($browserCandidates.Count -eq 0) {
        Write-Warning "Automated gates passed, but neither Microsoft Edge nor Chrome was found in the standard Windows locations."
        Write-Host "Load this folder manually from edge://extensions with Developer mode enabled: $Root"
        exit 0
    }

    $browser = $browserCandidates[0]
    $profile = Join-Path $env:TEMP "ovipet-helper-release-smoke"
    if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

    Write-Host "== Launching isolated browser smoke profile ==" -ForegroundColor Cyan
    Write-Host "Browser: $($browser.Name)"
    Write-Host "Executable: $($browser.Path)"
    Write-Host "Extension: $Root"
    Write-Host "Temporary profile: $profile"

    $arguments = @(
        "--user-data-dir=$profile",
        "--no-first-run",
        "--disable-extensions-except=$Root",
        "--load-extension=$Root",
        "https://ovipets.com/"
    )
    Start-Process -FilePath $browser.Path -ArgumentList $arguments

    Write-Host ""
    Write-Host "$($browser.Name) was opened with a TEMPORARY profile; your normal browser profile was not modified." -ForegroundColor Green
    Write-Host "Complete docs/WINDOWS_QA.md in the opened browser. Login may be required in this temporary profile."
} finally {
    Pop-Location
}
