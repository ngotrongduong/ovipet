param(
    [string]$Repository = "https://github.com/ngotrongduong/ovipet.git",
    [string]$Branch = "release/v5.3.17-runtime-import"
)

$ErrorActionPreference = "Stop"
$SourceRoot = Split-Path -Parent $PSScriptRoot
$TempRoot = Join-Path $env:TEMP ("ovipet-publish-" + [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss"))

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
    & git @Args
    if ($LASTEXITCODE -ne 0) { throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE" }
}

function Copy-PathIntoClone {
    param([string]$RelativePath, [string]$CloneRoot)
    $source = Join-Path $SourceRoot $RelativePath
    if (-not (Test-Path $source)) { throw "Missing RC path: $RelativePath" }
    $dest = Join-Path $CloneRoot $RelativePath
    $parent = Split-Path -Parent $dest
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    if (Test-Path $source -PathType Container) {
        if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
        Copy-Item -Recurse -Force $source $dest
    } else {
        Copy-Item -Force $source $dest
    }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is required. Install Git for Windows first."
}

Push-Location $SourceRoot
try {
    Write-Host "== Verify RC before publishing ==" -ForegroundColor Cyan
    node scripts/verify-js.js
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax gate failed" }
    node scripts/verify-release.js
    if ($LASTEXITCODE -ne 0) { throw "Release consistency gate failed" }
    node --test tests/*.test.js
    if ($LASTEXITCODE -ne 0) { throw "Regression suite failed" }
} finally {
    Pop-Location
}

Write-Host "== Clone GitHub control-plane repository ==" -ForegroundColor Cyan
Invoke-Git clone $Repository $TempRoot
Push-Location $TempRoot
try {
    Invoke-Git checkout main
    Invoke-Git pull --ff-only origin main

    # Use a fresh local branch based on current GitHub main. If the requested remote branch
    # already exists, use a timestamped branch instead of force-updating someone else's work.
    $remoteExists = (& git ls-remote --heads origin $Branch) -ne $null
    if ($LASTEXITCODE -ne 0) { throw "Could not query remote branches" }
    if ($remoteExists) {
        $Branch = $Branch + "-" + [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
    }
    Invoke-Git checkout -b $Branch

    Write-Host "== Overlay validated runtime/test tree (GitHub docs remain authoritative) ==" -ForegroundColor Cyan
    $paths = @(
        "background.js", "content.css", "content.js", "manifest.json", "offscreen.html", "offscreen.js", "page-bridge.js",
        "bg", "core", "dom", "domain", "features", "jobs", "ui", "scripts", "tests",
        ".github/workflows/ci.yml",
        ".claude/skills/bump-version/SKILL.md", ".claude/skills/eyes-ai-brief/SKILL.md",
        "docs/archive",
        "docs/daily-maintenance-fix-v504.md", "docs/database-first-automation.md", "docs/dom-audit-2026-09-17.md",
        "docs/eyes-ai-brief.md", "docs/manual-species-handoff-v420.md", "docs/pure-breeding-guide.md",
        "docs/same-tab-species-v421.md", "docs/scalable-automation-v419.md", "docs/stability-review-2026-09-19.md",
        "docs/transactional-state-v418.md", "docs/WINDOWS_QA.md", "docs/AUTOMATED_SOAK_REPORT_2026-09-19.md"
    )
    foreach ($path in $paths) { Copy-PathIntoClone $path $TempRoot }

    Write-Host "== Clean-clone verification ==" -ForegroundColor Cyan
    node scripts/verify-js.js
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax gate failed in clone" }
    node scripts/verify-release.js
    if ($LASTEXITCODE -ne 0) { throw "Release consistency gate failed in clone" }
    node --test tests/*.test.js
    if ($LASTEXITCODE -ne 0) { throw "Regression suite failed in clone" }

    Invoke-Git add -A
    $status = & git status --porcelain
    if (-not $status) {
        Write-Host "GitHub already contains the same runtime tree; nothing to publish." -ForegroundColor Green
        exit 0
    }

    Invoke-Git commit -m "chore: import validated v5.3.1 runtime baseline"
    Invoke-Git push -u origin $Branch

    $repoWeb = $Repository -replace '\.git$', ''
    Write-Host "" 
    Write-Host "Runtime branch published successfully." -ForegroundColor Green
    Write-Host "Open a PR: $repoWeb/compare/main...$Branch?expand=1"
    Write-Host "Do not merge until GitHub Actions is green."
} finally {
    Pop-Location
    Write-Host "Temporary clone retained for inspection: $TempRoot"
}
