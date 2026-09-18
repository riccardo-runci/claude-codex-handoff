$ErrorActionPreference = "Stop"

$repoUrl = "https://github.com/riccardo-runci/claude-codex-handoff.git"
$installDir = Join-Path $env:USERPROFILE ".claude-handoff"

if (Test-Path (Join-Path $installDir ".git")) {
    Write-Host "claude-handoff: aggiorno installazione esistente in $installDir"
    git -C $installDir pull --ff-only
} else {
    Write-Host "claude-handoff: clono in $installDir"
    git clone $repoUrl $installDir
}

Push-Location $installDir
try {
    npm link
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Fatto. Prova: claude-handoff --help"
