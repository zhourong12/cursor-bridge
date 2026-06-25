---
name: bot-collab
description: >-
  飞书多 bot 协作 @ 转交。当需要 @ 另一个 bot、bot 之间转交、或遇到 230002 / @ 不到时使用。
---

# Bot 协作 @ 转交

## 唯一正确流程

```
需要其他 bot 接手
  → 正文自然写 @名字 任务（如 @基石 请验收 U3）
    → bridge 自动转成结构化 @ 代发
      → 目标 bot 收到并处理
```

**Agent 只写自然语言 `@名字`，bridge 代发结构化 mention。**

## 铁律

1. **发件 bot 必须在目标群里**。`230002` = 发件 bot 不在群。
2. **open_id 由 bridge 自动登记**到 `~/.lark-channel/fleet.json`。
3. **禁止 agent 自跑 `lark-cli --as bot` 去 @ 别的 bot**。
4. **禁止以为纯文本 `@名字` 就能让 bot 收到**——必须经 bridge 转成结构化 @（写 `@名字` 即可，bridge 会转）。
5. **`chat.members` 不返回 bot**，open_id 走 fleet.json。

## 用户手动兜底（可选）

用户可在飞书发 `/delegate @名字 任务`（slash 命令，不是 agent 输出语法）。

## 故障排查

| 现象 | 原因 | 修法 |
|------|------|------|
| `230002` | 发件 bot 不在群 | 把发件 bot 加进群 |
| @ 到了对方没反应 | 目标 bot 不在群/没跑 | 确认在线 + 群在白名单 |
| 循环刷屏 | bot 互 @ 过多 | bridge 熔断后会停发结构化 @ |
