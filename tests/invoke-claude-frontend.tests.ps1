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
  echo CLAUDE_FAKE_OK:%2
  exit /b 0
)
echo expected -p
exit /b 2
"@ | Set-Content -Path $fakeClaude -Encoding ASCII

try {
    $json = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts\invoke-claude-frontend.ps1") `
        -Workspace $workspace `
        -ClaudePath $fakeClaude `
        -ArtifactDir ".omx/test-artifacts" `
        -Prompt "Build a responsive pricing table"

    $result = $json | ConvertFrom-Json

    if (-not $result.success) {
        throw "Expected success=true"
    }
    if ($result.exitCode -ne 0) {
        throw "Expected exitCode=0"
    }
    if (-not (Test-Path -LiteralPath $result.artifactPath)) {
        throw "Expected artifact to exist: $($result.artifactPath)"
    }

    $artifact = Get-Content -LiteralPath $result.artifactPath -Raw
    if ($artifact -notmatch "Build a responsive pricing table") {
        throw "Prompt was not captured in artifact"
    }
    if ($artifact -notmatch "CLAUDE_FAKE_OK") {
        throw "Claude output was not captured in artifact"
    }

    "PASS invoke-claude-frontend"
} finally {
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
}
