# Lark bridge restart: stop if running, then start foreground
$ErrorActionPreference = "Stop"
$Profile = "cursor"
$TaskName = "LarkChannelBridge.Bot.$Profile"
$script:BridgeRoot = Split-Path $PSScriptRoot -Parent

. "$PSScriptRoot\lark-bridge-env.ps1"

function Get-LarkBridgeNodeProcesses {
    Get-Process node -ErrorAction SilentlyContinue | ForEach-Object {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        if ($cmd -match 'lark-channel-bridge') { $_ }
    }
}

function Test-LarkBridgeDaemonRunning {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $result = schtasks /Query /TN $TaskName /V /FO LIST 2>&1 | Out-String
    $ErrorActionPreference = $prev
    if ($LASTEXITCODE -ne 0) { return $false }
    return ($result -match 'Status:\s+Running')
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
    Remove-Item (Join-Path $lockRoot "profile\cursor.lock*") -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $lockRoot "app\cli_a9463556dab9dbcb.lock*") -Recurse -Force -ErrorAction SilentlyContinue

    $registry = Join-Path $env:USERPROFILE ".lark-channel\registry\processes.json"
    if (Test-Path $registry) {
        $emptyRegistry = (@{ entries = @() } | ConvertTo-Json -Compress)
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($registry, $emptyRegistry, $utf8NoBom)
    }
}

$foreground = @(Get-LarkBridgeNodeProcesses)
$daemon = Test-LarkBridgeDaemonRunning

if ($foreground.Count -gt 0) {
    Write-Host "Foreground bridge detected ($($foreground.Count) process(es)), restarting..." -ForegroundColor Cyan
    Stop-LarkBridgeForeground | Out-Null
    Start-Sleep -Seconds 2
    Clear-LarkBridgeLocks
}
elseif ($daemon) {
    Write-Host "Scheduled task running, restarting daemon..." -ForegroundColor Cyan
    & npx lark-channel-bridge restart --profile $Profile
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Daemon restarted." -ForegroundColor Green
    exit 0
}
else {
    Write-Host "No running bridge found, starting..." -ForegroundColor Cyan
}

Write-Host "Workspace: $script:BridgeRoot" -ForegroundColor Cyan
Write-Host "Feishu: /cd D:\new-code\cursor-bridge" -ForegroundColor Cyan
& npx lark-channel-bridge run --agent cursor
