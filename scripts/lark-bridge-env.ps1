# Shared env loader for lark-channel-bridge (start / restart)
if (-not $script:BridgeRoot) {
    $callerRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $script:BridgeRoot = Split-Path $callerRoot -Parent
}
Set-Location $script:BridgeRoot

$envFile = Join-Path $script:BridgeRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"')
            Set-Item -Path "Env:$name" -Value $value
        }
    }
}

if (-not $env:CURSOR_API_KEY) {
    Write-Host "Set CURSOR_API_KEY in $envFile first" -ForegroundColor Yellow
    exit 1
}

# Windows: secrets-getter.cmd mode is always 0666; use LARK_APP_SECRET env instead.
if (-not $env:LARK_APP_SECRET) {
        $bridgeMjs = Join-Path $script:BridgeRoot "bin\lark-channel-bridge.mjs"
    if (Test-Path $bridgeMjs) {
        if (-not $env:LARK_CHANNEL_HOME) {
            $env:LARK_CHANNEL_HOME = Join-Path $env:USERPROFILE ".lark-channel"
        }
        if (-not $env:LARK_CHANNEL_PROFILE) {
            $env:LARK_CHANNEL_PROFILE = "cursor"
        }
        $appId = "cli_a9463556dab9dbcb"
        $secretKey = "app-$appId"
        $req = "{`"ids`":[`"$secretKey`"]}"
        $raw = $req | & node $bridgeMjs secrets get
        if ($raw) {
            $resp = $raw | ConvertFrom-Json
            $secret = $resp.values.$secretKey
            if ($secret) {
                Set-Item -Path Env:LARK_APP_SECRET -Value $secret
            }
        }
    }
}

if (-not $env:LARK_APP_SECRET) {
    Write-Host "LARK_APP_SECRET not loaded; Feishu API may be unavailable" -ForegroundColor Yellow
}
