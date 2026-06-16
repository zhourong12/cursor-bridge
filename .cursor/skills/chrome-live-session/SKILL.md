---
name: chrome-live-session
description: >-
  Operates the user's real Chrome via the Real Browser MCP extension bridge:
  list/focus tabs, navigate, snapshot+click menus, read text. Use for logged-in
  Chrome, live tabs, real-browser MCP. Not cursor-ide-browser unless named.
---

# Chrome Live Session（扩展桥）

配套规则：`.cursor/rules/chrome-live-session.mdc`。工作区默认路径 **`D:\new-code\cursor-bridge`**。

## Standard workflow

1. `browser_tabs` `list` → 匹配 URL → `focus` tabId
2. 只读文案：`browser_text`
3. 打开/点菜单：`browser_snapshot` → `browser_click` / `browser_click_text` → `browser_wait` → 再验证

## Quick reference

- `browser_tabs`, `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_click_text`, `browser_text`, `browser_wait`
- 参数以 `mcps/<server>/tools/*.json` 为准
