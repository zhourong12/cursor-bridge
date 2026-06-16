# cursor-bridge

飞书/Lark 与 Cursor Agent 的桥接服务，支持在飞书里对话驱动本地 Agent，并内置 `/schedule` 进程内定时任务。

基于 [lark-channel-bridge-cursor](https://github.com/mmnie-git/lark-channel-bridge-cursor) fork，源码在 `src/`。

## 前置

- Node.js ≥ 20
- [Cursor API Key](https://cursor.com/settings)
- 飞书自建应用（App ID / App Secret）

## 安装与启动

```powershell
git clone <your-repo-url> cursor-bridge
cd cursor-bridge
npm install
copy .env.example .env
# 编辑 .env，填入 CURSOR_API_KEY
npm run lark-bridge:cursor
```

日常命令（均会自动 `build`）：

```powershell
npm run lark-bridge:cursor    # 启动
npm run lark-bridge:restart   # 重启（改 src 后使用）
npm run build                 # 仅编译（一般不必单独跑）
```

## 配置在哪里

| 类型 | 位置 | 说明 |
|------|------|------|
| 仓库内 | `.env` | `CURSOR_API_KEY`（勿提交 Git） |
| 本机运行态 | `~/.lark-channel/config.json` | 飞书 app、profile、偏好等 |
| 本机运行态 | `~/.lark-channel/profiles/cursor/` | 会话、定时任务、日志、密钥库 |
| Agent 工作区 | `~/.lark-channel-workspaces/cursor/default` | 默认 cwd，飞书可用 `/cd` 切换 |

首次使用需在飞书里完成 `/account` 等初始化，或手动编辑 `~/.lark-channel/config.json`。

Windows 下若 `secrets-getter.cmd` 权限有问题，可在 `.env` 或环境中设置 `LARK_APP_SECRET`。

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
├── src/           # bridge 源码
├── bin/           # CLI 入口
├── scripts/       # 启动 / 重启脚本（Windows PowerShell）
├── dist/          # 构建产物（git 忽略）
└── .cursor/rules/ # Cursor 工作区规则（可选）
```

## License

MIT
