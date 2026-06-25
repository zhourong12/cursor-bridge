# Bridge Console - build / pack / run
# Usage:
#   .\scripts\console.ps1 pack
#   .\scripts\console.ps1 run
#   .\scripts\console.ps1 run -Portable
#   .\scripts\console.ps1 run -Build
#   .\scripts\console.ps1 serve   # 仅 HTTP；开浏览器请用 console-web.bat
param(
    [Parameter(Position = 0)]
    [ValidateSet('pack', 'run', 'serve')]
    [string]$Action = 'run',

    [switch]$Portable,
    [switch]$Build,
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

function Stop-PortListener([int]$Port = 3928) {
    try {
        $pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($procId in $pids) {
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($proc -and $proc.Name -match 'Bridge Console|node|electron') {
                Write-Host "[stop] $($proc.Name) (pid $procId) on port $Port" -ForegroundColor DarkYellow
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        }
    } catch { }
}

function Stop-BridgeConsole {
    Get-Process -Name 'Bridge Console', 'BridgeConsole-0.1.0-portable' -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Stop-PortListener
}

function Invoke-Npm([string]$Script) {
    Write-Host "[npm] $Script" -ForegroundColor Cyan
    & npm run $Script
    if ($LASTEXITCODE -ne 0) { throw "npm run $Script failed (exit $LASTEXITCODE)" }
}

function Test-ConsoleHealth([int]$Port = 3928, [int]$WaitSec = 15) {
    $deadline = (Get-Date).AddSeconds($WaitSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Show-TokenHint {
    param([switch]$Electron)
    $token = Get-AdminToken
    Write-Host ''
    if ($Electron) {
        Write-Host '[OK] Bridge Console 已启动（Electron 单窗口）。' -ForegroundColor Green
        Write-Host '     请勿同时运行 console-web.bat 或在浏览器打开同一地址，否则会像「两个窗口」。' -ForegroundColor Yellow
    } else {
        Write-Host '[OK] Bridge Console 已启动（浏览器）。' -ForegroundColor Green
        Write-Host '     请勿同时运行 run-console.cmd / Electron 便携版。' -ForegroundColor Yellow
    }
    Write-Host '     URL: http://127.0.0.1:3928' -ForegroundColor Green
    if ($token) {
        Write-Host "     Admin Token: $token" -ForegroundColor Yellow
    } else {
        Write-Host '     No admin-token yet; start once to generate it.' -ForegroundColor Yellow
    }
    Write-Host ''
}

function Resolve-ConsoleExe {
    param([switch]$Portable)
    if ($Portable) {
        return Join-Path $Root 'release\BridgeConsole-0.1.0-portable.exe'
    }
    return Join-Path $Root 'release\win-unpacked\Bridge Console.exe'
}

switch ($Action) {
    'pack' {
        Stop-BridgeConsole
        Start-Sleep -Seconds 2
        Invoke-Npm 'build'
        Write-Host '[electron-builder] portable + win-unpacked (close Bridge Console if Access denied)' -ForegroundColor Cyan
        & npx electron-builder --win portable
        if ($LASTEXITCODE -ne 0) {
            throw "electron-builder failed (exit $LASTEXITCODE). Close Bridge Console and retry."
        }
        Write-Host ''
        Write-Host "[OK] portable: $Root\release\BridgeConsole-0.1.0-portable.exe" -ForegroundColor Green
        Write-Host "[OK] unpacked: $Root\release\win-unpacked\Bridge Console.exe" -ForegroundColor Green
    }

    'run' {
        if ($Build -and -not $SkipBuild) {
            Invoke-Npm 'build'
        }

        $exe = Resolve-ConsoleExe -Portable:$Portable
        if (-not (Test-Path $exe)) {
            Write-Host "[warn] exe not found, packing first..." -ForegroundColor Yellow
            Stop-BridgeConsole
            Start-Sleep -Seconds 1
            Invoke-Npm 'pack:console'
            $exe = Resolve-ConsoleExe -Portable:$Portable
        }

        if (-not (Test-Path $exe)) {
            throw "exe not found: $exe"
        }

        Write-Host "[start] $exe" -ForegroundColor Cyan
        Stop-BridgeConsole
        Start-Sleep -Seconds 1
        Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe -Parent)

        if (Test-ConsoleHealth) {
            Show-TokenHint -Electron
        } else {
            Write-Host '[warn] process started but http://127.0.0.1:3928/api/health not ready in 15s' -ForegroundColor Yellow
            Write-Host '       check Task Manager for "Bridge Console", or run: npm run console:pack' -ForegroundColor Yellow
        }
    }

    'serve' {
        if (-not $SkipBuild) { Invoke-Npm 'build' }
        Write-Host '[start] admin serve (browser) — 推荐用 console-web.bat 自动开浏览器' -ForegroundColor Cyan
        Invoke-Npm 'console:serve'
    }
}
