param(
    [Parameter(Mandatory = $true)]
    [string]$Prompt,

    [string]$Workspace = (Get-Location).Path,

    [string]$ClaudePath = "claude",

    [string]$ArtifactDir = ".omx/artifacts",

    [string]$Model = "sonnet",

    [string]$FallbackModel = "",

    [ValidateSet("low", "medium", "high", "xhigh", "max")]
    [string]$Effort = "medium",

    [int]$HeartbeatSeconds = 30,

    [int]$PollIntervalMilliseconds = 250,

    [switch]$NoLiveOutput
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

function ConvertTo-ProcessArgument {
    param([string]$Value)

    if ($Value -notmatch '[\s"]') {
        return $Value
    }

    $escaped = $Value -replace '(\\*)"', '$1$1\"'
    $escaped = $escaped -replace '(\\+)$', '$1$1'
    return '"' + $escaped + '"'
}

function Write-RunLine {
    param(
        [string]$Stream,
        [string]$Text,
        [System.Collections.Generic.List[string]]$LogLines,
        [switch]$Quiet
    )

    $timestamp = Get-Date -Format "o"
    $line = "[$timestamp][$Stream] $Text"
    $LogLines.Add($line)
    if (-not $Quiet) {
        Write-Host "[$Stream] $Text"
    }
}

function Resolve-Executable {
    param([string]$Name)

    if ([System.IO.Path]::IsPathRooted($Name) -and (Test-Path -LiteralPath $Name)) {
        return (Resolve-Path -LiteralPath $Name).Path
    }

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        return $null
    }

    return $command.Source
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
$logPath = Join-Path $artifactRoot "claude-frontend-$slug-$timestamp.log"
$runnerPath = Join-Path $artifactRoot "claude-frontend-$slug-$timestamp.runner.ps1"
$stateRoot = Join-Path $workspacePath ".omx/state"
$installDeclinedMarkerPath = Join-Path $stateRoot "claude-install-declined.json"

$logLines = [System.Collections.Generic.List[string]]::new()
$stdoutLines = [System.Collections.Generic.List[string]]::new()
$stderrLines = [System.Collections.Generic.List[string]]::new()
$exitCode = 127
$startTime = Get-Date
$lastOutputTime = $startTime

try {
    $resolvedClaudePath = Resolve-Executable -Name $ClaudePath
    if ($null -eq $resolvedClaudePath) {
        $message = "Claude CLI was not found. Ask the user whether to install and configure Claude; if they decline, record that decision at $installDeclinedMarkerPath."
        $stderrLines.Add($message)
        Write-RunLine -Stream "error" -Text $message -LogLines $logLines -Quiet:$NoLiveOutput
        throw $message
    }

    if (-not $NoLiveOutput) {
        Write-Host "[codex-ask-claude] starting Claude CLI in $workspacePath"
    }

    $runner = @'
param(
    [string]$ClaudePath,
    [string]$Prompt,
    [string]$Model,
    [string]$FallbackModel,
    [string]$Effort
)

$argsList = @("-p", "--output-format", "stream-json", "--include-partial-messages")
if (-not [string]::IsNullOrWhiteSpace($Model)) {
    $argsList += @("--model", $Model)
}
if (-not [string]::IsNullOrWhiteSpace($FallbackModel)) {
    $argsList += @("--fallback-model", $FallbackModel)
}
if (-not [string]::IsNullOrWhiteSpace($Effort)) {
    $argsList += @("--effort", $Effort)
}
$argsList += $Prompt

& $ClaudePath @argsList
if ($null -eq $LASTEXITCODE) {
    exit 0
}
exit $LASTEXITCODE
'@
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($runnerPath, $runner, $utf8NoBom)

    $powerShellPath = (Get-Process -Id $PID).Path
    $argumentList = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", (ConvertTo-ProcessArgument -Value $runnerPath),
        "-ClaudePath", (ConvertTo-ProcessArgument -Value $resolvedClaudePath),
        "-Prompt", (ConvertTo-ProcessArgument -Value $Prompt),
        "-Model", (ConvertTo-ProcessArgument -Value $Model),
        "-FallbackModel", (ConvertTo-ProcessArgument -Value $FallbackModel),
        "-Effort", (ConvertTo-ProcessArgument -Value $Effort)
    ) -join " "

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $powerShellPath
    $startInfo.Arguments = $argumentList
    $startInfo.WorkingDirectory = $workspacePath
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $null = $process.Start()

    $stdoutTask = $process.StandardOutput.ReadLineAsync()
    $stderrTask = $process.StandardError.ReadLineAsync()
    $stdoutDone = $false
    $stderrDone = $false

    while (-not ($process.HasExited -and $stdoutDone -and $stderrDone)) {
        $hadOutput = $false

        if (-not $stdoutDone -and $stdoutTask.IsCompleted) {
            $line = $stdoutTask.Result
            if ($null -eq $line) {
                $stdoutDone = $true
            } else {
                $stdoutLines.Add($line)
                Write-RunLine -Stream "stdout" -Text $line -LogLines $logLines -Quiet:$NoLiveOutput
                $lastOutputTime = Get-Date
                $hadOutput = $true
                $stdoutTask = $process.StandardOutput.ReadLineAsync()
            }
        }

        if (-not $stderrDone -and $stderrTask.IsCompleted) {
            $line = $stderrTask.Result
            if ($null -eq $line) {
                $stderrDone = $true
            } else {
                $stderrLines.Add($line)
                Write-RunLine -Stream "stderr" -Text $line -LogLines $logLines -Quiet:$NoLiveOutput
                $lastOutputTime = Get-Date
                $hadOutput = $true
                $stderrTask = $process.StandardError.ReadLineAsync()
            }
        }

        if (-not $hadOutput -and $HeartbeatSeconds -gt 0) {
            $idleSeconds = ((Get-Date) - $lastOutputTime).TotalSeconds
            if ($idleSeconds -ge $HeartbeatSeconds) {
                $lastOutputTime = Get-Date
                Write-RunLine -Stream "status" -Text "Claude is still running; waiting for output..." -LogLines $logLines -Quiet:$NoLiveOutput
            }
        }

        Start-Sleep -Milliseconds $PollIntervalMilliseconds
    }

    $process.WaitForExit()
    $process.Refresh()
    $exitCode = $process.ExitCode
} catch {
    $stderrLines.Add($_.Exception.Message)
    Write-RunLine -Stream "error" -Text $_.Exception.Message -LogLines $logLines -Quiet:$NoLiveOutput
    $exitCode = 127
}

$durationSeconds = [math]::Round(((Get-Date) - $startTime).TotalSeconds, 2)
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($logPath, ($logLines -join [Environment]::NewLine), $utf8NoBom)

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
    "## Duration Seconds",
    "",
    [string]$durationSeconds,
    "",
    "## Model",
    "",
    $Model,
    "",
    "## Fallback Model",
    "",
    $FallbackModel,
    "",
    "## Effort",
    "",
    $Effort,
    "",
    "## Live Output Log",
    "",
    $logPath,
    "",
    "## Stdout",
    "",
    '```text',
    ($stdoutLines -join [Environment]::NewLine),
    '```',
    "",
    "## Stderr",
    "",
    '```text',
    ($stderrLines -join [Environment]::NewLine),
    '```'
)

$artifact = $artifactLines -join [Environment]::NewLine
[System.IO.File]::WriteAllText($artifactPath, $artifact, $utf8NoBom)

Remove-Item -LiteralPath $runnerPath -Force -ErrorAction SilentlyContinue

$previewText = (($stdoutLines + $stderrLines) -join "`n") -replace '\s+', ' '
$result = [ordered]@{
    success = ($exitCode -eq 0)
    exitCode = $exitCode
    durationSeconds = $durationSeconds
    model = $Model
    fallbackModel = $FallbackModel
    effort = $Effort
    needsClaudeInstall = ($null -eq (Resolve-Executable -Name $ClaudePath))
    installDeclinedMarkerPath = $installDeclinedMarkerPath
    artifactPath = $artifactPath
    logPath = $logPath
    outputPreview = $previewText.Trim()
}

$result | ConvertTo-Json -Depth 4 -Compress

if ($exitCode -ne 0) {
    exit $exitCode
}
