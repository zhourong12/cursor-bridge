# Bridge-side lark-auth: same flow as /lark-auth, sends link + QR to p2p chat.
$ErrorActionPreference = "Stop"
$script:BridgeRoot = Split-Path $PSScriptRoot -Parent
$ProfileDir = Join-Path $env:USERPROFILE ".lark-channel\profiles\cursor"
$AuthDir = Join-Path $ProfileDir "lark-auth"
$LarkCliDir = Join-Path $ProfileDir "lark-cli\lark-channel"
$ChatId = "oc_b22f7a39dbcc485f1f018cfce34b7b07"
$Domain = "calendar,im,docs,drive,wiki"

Set-Location $script:BridgeRoot
. "$script:BridgeRoot\scripts\lark-bridge-env.ps1"

$env:LARKSUITE_CLI_CONFIG_DIR = $LarkCliDir
New-Item -ItemType Directory -Force -Path $AuthDir | Out-Null

# auth login needs user-capable policy (profile default is bot-only strict)
lark-cli config strict-mode off | Out-Null
lark-cli config default-as auto | Out-Null

Write-Host "=== lark-cli auth login --no-wait ===" -ForegroundColor Cyan
$authRaw = lark-cli auth login --domain $Domain --no-wait --json 2>&1 | Out-String
Write-Host $authRaw
$auth = $authRaw | ConvertFrom-Json
if ($auth.ok -eq $false -or $auth.error) {
  throw ($auth | ConvertTo-Json -Compress)
}

$url = $auth.verification_url
if (-not $url) { $url = $auth.verification_uri_complete }
if (-not $url) { $url = $auth.verification_uri }
$device = $auth.device_code
if (-not $device) { $device = $auth.deviceCode }
if (-not $url -or -not $device) {
  throw "missing verification_url or device_code"
}

$pending = @{
  deviceCode      = $device
  verificationUrl = $url
  requestKind     = "domain"
  requestValue    = $Domain
  createdAt       = (Get-Date).ToUniversalTime().ToString("o")
}
$pendingPath = Join-Path $AuthDir "pending.json"
$pendingJson = ($pending | ConvertTo-Json -Depth 3) + [Environment]::NewLine
[System.IO.File]::WriteAllText($pendingPath, $pendingJson, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Saved pending: $pendingPath" -ForegroundColor Green

Push-Location $AuthDir
lark-cli auth qrcode $url --output ./lark-auth-qrcode.png 2>&1 | Out-Host

$nl = [Environment]::NewLine
$body = "已生成 lark-cli 用户授权链接（bridge 发起）：${nl}${nl}${url}${nl}${nl}请浏览器打开或扫下方二维码，完成后私聊发送：/lark-auth done"

Write-Host "=== send link ===" -ForegroundColor Cyan
lark-cli im +messages-send --chat-id $ChatId --markdown $body --json 2>&1 | Out-Host

Write-Host "=== send QR ===" -ForegroundColor Cyan
lark-cli im +messages-send --chat-id $ChatId --image lark-auth-qrcode.png --json 2>&1 | Out-Host
Pop-Location

Write-Host "Done." -ForegroundColor Green
