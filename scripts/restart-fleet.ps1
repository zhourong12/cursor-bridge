# Lark bridge fleet restart: stop all profiles, then fleet start (multi-bot)
param(
    [switch]$All
)

$ErrorActionPreference = "Stop"
$script:BridgeRoot = Split-Path $PSScriptRoot -Parent

. "$PSScriptRoot\lark-bridge-env.ps1"

function Get-LarkBridgeNodeProcesses {
    Get-Process node -ErrorAction SilentlyContinue | ForEach-Object {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        if ($cmd -match 'lark-channel-bridge') { $_ }
    }
}

function Stop-LarkBridgeForeground {
    $procs = @(Get-LarkBridgeNodeProcesses)
    if ($procs.Count -eq 0) { return $false }

    foreach ($p in $procs) {
        Stop-Process -Id $p.Id -Force
        Write-Host "Stopped bridge PID $($p.Id)" -ForegroundColor Yellow
    }
    return $true
}

function Clear-LarkBridgeLocks {
    $lockRoot = Join-Path $env:USERPROFILE ".lark-channel\registry\locks"
    foreach ($sub in @("profile", "app")) {
        $dir = Join-Path $lockRoot $sub
        if (-not (Test-Path $dir)) { continue }
        Get-ChildItem $dir -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }

    $registry = Join-Path $env:USERPROFILE ".lark-channel\registry\processes.json"
    if (Test-Path $registry) {
        $emptyRegistry = (@{ entries = @() } | ConvertTo-Json -Compress)
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($registry, $emptyRegistry, $utf8NoBom)
    }
}

function Invoke-FleetCli {
    param([string[]]$CliArgs)
    $cli = Join-Path $script:BridgeRoot "bin\lark-channel-bridge.mjs"
    if (-not (Test-Path $cli)) {
        $cli = Join-Path $script:BridgeRoot "dist\cli.js"
    }
    if (Test-Path $cli) {
        & node $cli @CliArgs
    } else {
        & npx lark-channel-bridge @CliArgs
    }
    return $LASTEXITCODE
}

$scopeLabel = if ($All) { "all profiles" } else { "autoStart (fleet.json)" }

$foreground = @(Get-LarkBridgeNodeProcesses)
if ($foreground.Count -gt 0) {
    Write-Host "Foreground bridge detected ($($foreground.Count) process(es)), stopping..." -ForegroundColor Cyan
    Stop-LarkBridgeForeground | Out-Null
    Start-Sleep -Seconds 2
}

Write-Host "Stopping fleet daemons..." -ForegroundColor Cyan
$prev = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
Invoke-FleetCli @("fleet", "stop", "--all") | Out-Null
$ErrorActionPreference = $prev
Start-Sleep -Seconds 2

Clear-LarkBridgeLocks

Write-Host "Workspace: $script:BridgeRoot" -ForegroundColor Cyan
Write-Host "Starting fleet ($scopeLabel)..." -ForegroundColor Cyan

if ($All) {
    $code = Invoke-FleetCli @("fleet", "start", "--all")
} else {
    $code = Invoke-FleetCli @("fleet", "start")
}
if ($code -ne 0) { exit $code }

Write-Host ""
Write-Host "Fleet started." -ForegroundColor Green
Write-Host "Bot daemon logs: each profile under logs/daemon/ (not streamed in this window)." -ForegroundColor Yellow
Write-Host '  e.g. Get-Content $env:USERPROFILE\.lark-channel\profiles\cursor\logs\daemon\daemon-stdout.log -Tail 20 -Wait' -ForegroundColor DarkGray
Write-Host ""
Invoke-FleetCli @("fleet", "status", "--all")
exit 0
