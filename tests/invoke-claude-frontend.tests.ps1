Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("codex-ask-claude-test-" + [Guid]::NewGuid().ToString("N"))
$workspace = Join-Path $tmpRoot "workspace"
$bin = Join-Path $tmpRoot "bin"

New-Item -ItemType Directory -Path $workspace, $bin -Force | Out-Null

$fakeClaude = Join-Path $bin "claude.cmd"
@"
@echo off
if "%1"=="-p" (
  echo CLAUDE_FAKE_STDOUT:%2
  echo CLAUDE_FAKE_STDERR 1>&2
  exit /b 0
)
echo expected -p
exit /b 2
"@ | Set-Content -Path $fakeClaude -Encoding ASCII

try {
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts\invoke-claude-frontend.ps1") `
        -Workspace $workspace `
        -ClaudePath $fakeClaude `
        -ArtifactDir ".omx/test-artifacts" `
        -Model "sonnet" `
        -FallbackModel "opus" `
        -Effort "medium" `
        -Prompt "Build a responsive pricing table"

    $json = $output | Where-Object { $_ -like "{*" } | Select-Object -Last 1
    $result = $json | ConvertFrom-Json

    if (-not $result.success) {
        throw "Expected success=true"
    }
    if ($result.exitCode -ne 0) {
        throw "Expected exitCode=0"
    }
    if ($result.model -ne "sonnet") {
        throw "Expected model=sonnet"
    }
    if ($result.fallbackModel -ne "opus") {
        throw "Expected fallbackModel=opus"
    }
    if ($result.effort -ne "medium") {
        throw "Expected effort=medium"
    }
    if (-not (Test-Path -LiteralPath $result.artifactPath)) {
        throw "Expected artifact to exist: $($result.artifactPath)"
    }
    if (-not (Test-Path -LiteralPath $result.logPath)) {
        throw "Expected log to exist: $($result.logPath)"
    }

    $artifact = Get-Content -LiteralPath $result.artifactPath -Raw
    if ($artifact -notmatch "Build a responsive pricing table") {
        throw "Prompt was not captured in artifact"
    }
    if ($artifact -notmatch "CLAUDE_FAKE_STDOUT") {
        throw "Claude stdout was not captured in artifact"
    }
    if ($artifact -notmatch "CLAUDE_FAKE_STDERR") {
        throw "Claude stderr was not captured in artifact"
    }

    $log = Get-Content -LiteralPath $result.logPath -Raw
    if ($log -notmatch "\[stdout\].*CLAUDE_FAKE_STDOUT") {
        throw "Claude stdout was not tagged in live log"
    }
    if ($log -notmatch "\[stderr\].*CLAUDE_FAKE_STDERR") {
        throw "Claude stderr was not tagged in live log"
    }

    $missingOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts\invoke-claude-frontend.ps1") `
        -Workspace $workspace `
        -ClaudePath (Join-Path $bin "missing-claude.cmd") `
        -ArtifactDir ".omx/test-artifacts" `
        -NoLiveOutput `
        -Prompt "Build a responsive pricing table" 2>$null

    $missingJson = $missingOutput | Where-Object { $_ -like "{*" } | Select-Object -Last 1
    $missingResult = $missingJson | ConvertFrom-Json
    if (-not $missingResult.needsClaudeInstall) {
        throw "Expected missing Claude to set needsClaudeInstall=true"
    }

    $rememberJson = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts\remember-claude-install-declined.ps1") `
        -Workspace $workspace `
        -Reason "test decline"
    $rememberResult = $rememberJson | ConvertFrom-Json
    if (-not (Test-Path -LiteralPath $rememberResult.markerPath)) {
        throw "Expected install decline marker to exist"
    }

    "PASS invoke-claude-frontend"
} finally {
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
}
