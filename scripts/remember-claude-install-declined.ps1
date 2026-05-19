param(
    [string]$Workspace = (Get-Location).Path,

    [string]$Reason = "User declined Claude CLI installation/configuration."
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspacePath = (Resolve-Path -LiteralPath $Workspace).Path
$stateRoot = Join-Path $workspacePath ".omx/state"
$markerPath = Join-Path $stateRoot "claude-install-declined.json"

New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null

$record = [ordered]@{
    declined = $true
    reason = $Reason
    recordedAt = (Get-Date).ToString("o")
}

$json = $record | ConvertTo-Json -Depth 4
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($markerPath, $json, $utf8NoBom)

[ordered]@{
    success = $true
    markerPath = $markerPath
} | ConvertTo-Json -Depth 4 -Compress
