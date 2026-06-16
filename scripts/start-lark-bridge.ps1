# Lark-channel-bridge foreground start
$ErrorActionPreference = "Stop"
$script:BridgeRoot = Split-Path $PSScriptRoot -Parent

. "$PSScriptRoot\lark-bridge-env.ps1"

Write-Host "Workspace: $script:BridgeRoot" -ForegroundColor Cyan
Write-Host "Feishu: /cd D:\new-code\cursor-bridge" -ForegroundColor Cyan
& npx lark-channel-bridge run --agent cursor
