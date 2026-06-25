# Bridge Console Web: stop old listeners -> build -> admin serve (browser)
param(
    [int]$Port = 3928,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

function Get-AdminToken {
    if ($env:LARK_BRIDGE_ADMIN_TOKEN) { return $env:LARK_BRIDGE_ADMIN_TOKEN.Trim() }
    $tokenFile = Join-Path $env:USERPROFILE '.lark-channel\admin-token'
    if (Test-Path $tokenFile) { return (Get-Content $tokenFile -Raw).Trim() }
    return $null
}

function Stop-AdminPortListener {
    param([int]$ListenPort = 3928)
    try {
        $pids = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($procId in $pids) {
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($proc -and $proc.Name -match 'Bridge Console|node|electron') {
                Write-Host "[stop] $($proc.Name) (pid $procId) on port $ListenPort" -ForegroundColor DarkYellow
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        }
    } catch { }
}

Get-Process -Name 'Bridge Console', 'BridgeConsole-0.1.0-portable' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
Stop-AdminPortListener -ListenPort $Port
Start-Sleep -Seconds 1

Write-Host '[info] Web mode: browser only. Do not also run run-console.cmd (Electron).' -ForegroundColor DarkGray

if (-not $SkipBuild) {
    Write-Host '[npm] build' -ForegroundColor Cyan
    & npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$url = "http://127.0.0.1:$Port"
Write-Host "[start] Bridge Console (Web) $url" -ForegroundColor Cyan
Write-Host '      Press Ctrl+C to stop' -ForegroundColor DarkGray
$token = Get-AdminToken
if ($token) {
    Write-Host "      Admin Token: $token" -ForegroundColor Yellow
}

& npx lark-channel-bridge admin serve --port $Port --open
exit $LASTEXITCODE
