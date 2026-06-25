# Dev Team --verify smoke for Bridge Console (API + static + CJS path)
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$fail = 0
function Assert($id, $name, [scriptblock]$Test) {
    try {
        & $Test
        Write-Host "[PASS] $id $name" -ForegroundColor Green
    } catch {
        Write-Host "[FAIL] $id $name — $($_.Exception.Message)" -ForegroundColor Red
        $script:fail++
    }
}

Assert 'CJS-01' 'admin-boot static path' {
    node -e "delete process.env.BRIDGE_ADMIN_STATIC; const m=require('./dist/admin-boot.cjs'); const fs=require('fs'); const p=m.adminStaticDir(); if(!fs.existsSync(p)) throw new Error('missing '+p);"
    if ($LASTEXITCODE -ne 0) { throw 'node exit non-zero' }
}

$tokenFile = Join-Path $env:USERPROFILE '.lark-channel\admin-token'
$token = if (Test-Path $tokenFile) { (Get-Content $tokenFile -Raw).Trim() } else { $null }
if (-not $token) { Write-Host '[WARN] 无 admin-token，跳过 Bearer API' -ForegroundColor Yellow }

Assert 'API-01' 'GET /api/health' {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:3928/api/health' -TimeoutSec 3
    if (-not $h.ok) { throw "ok=$($h.ok)" }
}

Assert 'API-03' 'GET / 静态页' {
    $html = (Invoke-WebRequest -Uri 'http://127.0.0.1:3928/' -UseBasicParsing -TimeoutSec 3).Content
    if ($html -notmatch 'Bridge Console') { throw 'missing title' }
}

if ($token) {
    $headers = @{ Authorization = "Bearer $token" }
    Assert 'API-02' 'GET /api/overview' {
        $o = Invoke-RestMethod -Uri 'http://127.0.0.1:3928/api/overview' -Headers $headers -TimeoutSec 3
        if ($null -eq $o.runningCount) { throw 'missing runningCount' }
    }
    Assert 'UI-BOTS-01' 'GET /api/bots' {
        $b = Invoke-RestMethod -Uri 'http://127.0.0.1:3928/api/bots' -Headers $headers -TimeoutSec 3
        if (-not ($b -is [Array])) { throw 'not array' }
    }
}

$exe = Join-Path $Root 'release\win-unpacked\Bridge Console.exe'
Assert 'EXE-01' 'unpacked exe exists' {
    if (-not (Test-Path $exe)) { throw "missing $exe" }
}

Write-Host ''
if ($fail -eq 0) {
    Write-Host 'VERIFY: PASS' -ForegroundColor Green
    exit 0
}
Write-Host "VERIFY: FAIL ($fail failed)" -ForegroundColor Red
exit 1
