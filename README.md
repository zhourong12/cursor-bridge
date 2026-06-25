# cursor-bridge

飞书/Lark 与 Cursor Agent 的桥接服务，支持在飞书里对话驱动本地 Agent，并内置 `/schedule` 进程内定时任务。

## 前置

- Node.js ≥ 20
- [Cursor API Key](https://cursor.com/settings)
- 飞书自建应用（App ID / App Secret）

## 安装

```powershell
git clone <your-repo-url> cursor-bridge
cd cursor-bridge
npm install
copy .env.example .env
# 编辑 .env，填入 CURSOR_API_KEY
```

## 三类服务（务必区分）

本仓库有三个**互相独立**的服务，职责、进程、端口各不相同：

| 服务 | 作用 | 进程/端口 | 启动 |
|------|------|-----------|------|
| **Bot 运行时** | 真正连飞书、跑 Cursor Agent、处理 `/schedule` | 每 profile 一个 node 进程；不占 3928 | `start.bat` / `fleet-restart.bat` |
| **Console · Electron** | 桌面管理 UI（概览/绑定/Fleet/进程/定时/日志） | 内嵌 HTTP `3928`，1 个窗口 | `run-console.cmd` |
| **Console · Web** | 与 Electron 同一套 Admin API + 静态页，浏览器打开 | 共用 `3928`（与 Electron 二选一） | `console-web.bat` |

> Console 只是**管理界面**，打开它**不会**自动连接飞书；Bot 需单独由 Bot 运行时或 Fleet 启动。
> Console Electron 与 Web 同占 3928，**二选一**；Bot 运行时不占 3928，可与 Console 同时存在。

## 启动 Bot

### 单 Bot（开发/调试）

```powershell
npm run lark-bridge:cursor    # 启动（自动 build）
npm run lark-bridge:restart   # 重启（改 src 后使用）
npm run build                 # 仅编译
```

### Fleet 多 Bot（多 profile 同时在线）

配置在 `~/.lark-channel/fleet.json`（`autoStart`、`bots`）。按 profile 拉起多个 Bot 进程：

```powershell
.\fleet-restart.bat                       # 重启 Fleet（改 src / 改 Key 后）
npm run fleet:status                       # 查看各 Bot 状态
lark-channel-bridge fleet status --all
```

## 管理界面（Console）

```powershell
.\run-console.cmd      # Electron 桌面壳
.\console-web.bat      # 浏览器，登录 http://127.0.0.1:3928/?token=<admin-token>
npm run pack:console   # 打包 → release/win-unpacked/Bridge Console.exe
```

`admin-token` 在 `~/.lark-channel/admin-token`。

## 配置在哪里

| 类型 | 位置 | 说明 |
|------|------|------|
| 仓库内 | `.env` | `CURSOR_API_KEY`（勿提交 Git） |
| 本机运行态 | `~/.lark-channel/config.json` | 飞书 app、profile、偏好等 |
| 本机运行态 | `~/.lark-channel/profiles/cursor/` | 会话、定时任务、日志、密钥库 |
| Agent 工作区 | `~/.lark-channel-workspaces/cursor/default` | 默认 cwd，飞书可用 `/cd` 切换 |

首次使用需在飞书里完成 `/account` 等初始化，或手动编辑 `~/.lark-channel/config.json`。

Windows 下若 `secrets-getter.cmd` 权限有问题，可在 `.env` 或环境中设置 `LARK_APP_SECRET`。

### 环境变量（可选，调优长连接/自愈）

| 变量 | 默认 | 说明 |
|------|------|------|
| `CURSOR_API_KEY` | — | 必填，Cursor API Key |
| `CURSOR_RESUME_IDLE_MS` | `1800000`（30 分钟） | 距上次对话超过此空闲时长则不再 resume，自动开新 Agent 上下文 |
| `CURSOR_SEND_TIMEOUT_MS` | `600000`（10 分钟） | `agent.send` 超时；超时后取消挂死的 run 并自愈重试 |
| `CURSOR_RUN_WAIT_TIMEOUT_MS` | 同 send | 等待 run 完成的超时 |

> Bot 内置超时 + 自愈（discard-and-recreate）+ 看门狗（每 5 分钟清理陈旧 run），以缓解长时间运行后「必须重启」的问题。运行统计写入 `~/.lark-channel/profiles/<profile>/runtime-stats.json`，Console `/api/health` 可读。

### 修改 Cursor Key 后

Key 在 Bot **进程启动时固化**，改 Key 必须：

1. 更新 `.env`（或环境）里的 `CURSOR_API_KEY`
2. **重启 Fleet**（`fleet-restart.bat` 或 Console → 重启 Fleet）——重写 daemon 启动脚本并刷新进程环境

只改 Key 不重启会继续用旧 Key，表现为飞书报 `Authentication error`。

## 定时任务

bridge 常驻时，进程内每分钟检查 cron（无需 Windows 计划任务）：

```
/schedule add 0 9 * * * 巡检工作区并总结
/schedule list
/schedule remove <id>
/schedule help
```

## 项目结构

```
cursor-bridge/
├── src/           # bridge 源码（agent / bot / admin / fleet / runtime ...）
├── desktop/       # Console Electron 主进程
├── bin/           # CLI 入口
├── scripts/       # 启动 / 重启 / Console 脚本（Windows PowerShell）
├── *.bat / *.cmd  # 快捷入口（start / fleet-restart / run-console / console-web）
├── dist/          # 构建产物（git 忽略）
└── .cursor/rules/ # Cursor 工作区规则（含三类服务说明）
```

## License

MIT
