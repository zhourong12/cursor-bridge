---
name: lark-channel-bridge
description: >-
  本仓库即 lark-channel-bridge-cursor fork：飞书 ↔ Cursor Agent，源码在 src/。
  启动 npm run lark-bridge:cursor；飞书 /cd D:\new-code\cursor-bridge。
---

# Lark Channel Bridge

本工作区 **已合并 bridge 源码**（`src/`），不再使用 `vendor/`。

## 三类服务（详见 `.cursor/rules/services.mdc`）

| 服务 | 作用 | 启动 |
|------|------|------|
| **Bot 运行时** | 连飞书、跑 Agent | `start.bat` / `fleet-restart.bat` |
| **Console Electron** | 桌面管理 UI · :3928 | `run-console.cmd` |
| **Console Web** | 浏览器管理 UI · :3928 | `console-web.bat` |

Bot 与 Console **可同时开**；Console Electron 与 Web **二选一**（同占 3928）。

## 单 Bot 启动

```powershell
cd D:\new-code\cursor-bridge
npm run lark-bridge:cursor
```

## 改代码后

```powershell
npm run lark-bridge:restart
```
