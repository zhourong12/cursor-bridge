# cursor-bridge

飞书 ↔ Cursor Agent（含 `/schedule` 定时任务）+ real-browser MCP。  
工作区路径：`D:\new-code\cursor-bridge`

## 安装与启动

```powershell
cd D:\new-code\cursor-bridge
npm install
copy .env.example .env
# 编辑 .env 填入 CURSOR_API_KEY
npm run lark-bridge:cursor
```

首次 `npm install` 后，日常 **启动 / 重启一条命令即可**（会自动 `build`）：

```powershell
npm run lark-bridge:cursor    # 启动
npm run lark-bridge:restart   # 重启（改 src 后用这个）
```

单独编译：`npm run build`（一般不必手动跑）

飞书里：`/cd D:\new-code\cursor-bridge`

## 定时任务

bridge 常驻时进程内每分钟检查（无需 Windows 计划任务）：

```
/schedule add 0 9 * * * 巡检仓库并总结
/schedule list
/schedule remove <id>
```

自然语言描述需求时，Agent 会生成对应的 `/schedule add` 命令（见 `.cursor/rules/scheduler.mdc`）。

## 改 bridge 源码后

```powershell
npm run lark-bridge:restart
```

源码在 `src/`，由 [lark-channel-bridge-cursor](https://github.com/mmnie-git/lark-channel-bridge-cursor) fork 合并而来。

## Cursor 工作区

**Open Folder → `D:\new-code\cursor-bridge`**（不要只开 `D:\new-code` 根目录）。
