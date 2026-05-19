param(
    [Parameter(Mandatory = $true)]
    [string]$Prompt,

    [string]$Workspace = (Get-Location).Path,

    [string]$ClaudePath = "claude",

    [string]$ArtifactDir = ".omx/artifacts"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function New-Slug {
    param([string]$Text)
    $slug = ($Text.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
    if ([string]::IsNullOrWhiteSpace($slug)) {
        return "frontend-ui"
    }
    if ($slug.Length -gt 48) {
        return $slug.Substring(0, 48).Trim('-')
    }
    return $slug
}

$workspacePath = (Resolve-Path -LiteralPath $Workspace).Path
$artifactRoot = if ([System.IO.Path]::IsPathRooted($ArtifactDir)) {
    $ArtifactDir
} else {
    Join-Path $workspacePath $ArtifactDir
}

New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$slug = New-Slug -Text $Prompt
$artifactPath = Join-Path $artifactRoot "claude-frontend-$slug-$timestamp.md"

Push-Location $workspacePath
try {
    $output = & $ClaudePath -p $Prompt 2>&1
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
} catch {
    $output = $_.Exception.Message
    $exitCode = 127
} finally {
    Pop-Location
}

$artifactLines = @(
    "# Claude Frontend Run",
    "",
    "## Prompt",
    "",
    '```text',
    $Prompt,
    '```',
    "",
    "## Exit Code",
    "",
    [string]$exitCode,
    "",
    "## Claude Output",
    "",
    '```text',
    ($output -join [Environment]::NewLine),
    '```'
)
$artifact = $artifactLines -join [Environment]::NewLine
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($artifactPath, $artifact, $utf8NoBom)

$result = [ordered]@{
    success = ($exitCode -eq 0)
    exitCode = $exitCode
    artifactPath = $artifactPath
    outputPreview = (($output -join "`n") -replace '\s+', ' ').Trim()
}

$result | ConvertTo-Json -Depth 4

if ($exitCode -ne 0) {
    exit $exitCode
}
