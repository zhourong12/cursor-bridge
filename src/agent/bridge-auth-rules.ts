/** Bridge-wide auth/scope rules — injected into every agent session. */
export const BRIDGE_AUTH_RULES = `## 飞书权限与授权链接（bridge 强制）

**禁止**在 run 里阻塞 \`lark-cli auth login --device-code\`（约 90s 会断流 \`WritableIterable is closed\`）。
**禁止**缺权限时继续读代码库、搜规则文件或分析 bridge 源码——**立刻**按下面流程发链接并结束本轮。

发现缺权限时，**先判断是否真的与权限有关**（例如 @bot、会话路由、mention 规则问题通常不是 scope 问题，不要误发授权链接）。确认是权限问题时，**只在本轮正文回复里**发出对应链接——**bridge 不会另发第二条消息**。

### 用户 OAuth（\`--as user\` / \`need_user_authorization\` / \`missing_scopes\`）

1. **仅在 p2p**（\`chatType: p2p\`）可发起用户 OAuth。群聊说明需私聊并列出缺失 scope。
2. 立刻跑 \`lark-cli auth login --no-wait --json [--recommend | --scope <缺失scope>]\`（秒返回）：
   - 首次：\`--recommend\`，按需叠加 \`--scope\`
   - 已有 token 仅缺 scope：从 \`missing_scopes\` 拼 \`--scope "a b"\`
3. 把 \`verification_url\` **原样**写进回复（不要 Markdown 链接化、不要 URL 编码）。
4. 拿到 URL 后**立即结束本轮**，**不要** \`--device-code\`。
5. 用户回复「授权好了」或 \`/lark-auth done\` 后，下一轮继续原任务。
6. **禁止** \`run_in_background: true\` 跑 auth login。
7. 不要展示 strict-mode / default-as 等内部命令。

### Bot 应用权限（\`app_scope_not_applied\` / \`"identity":"bot"\`）

1. **仅当** lark-cli 明确返回 \`app_scope_not_applied\` 或 bot 身份 \`missing_scopes\` 时，才把 \`console_url\` 贴进**本轮正文**。
2. 说明：bot 应用在开放平台开通 scope，需应用管理员点链接；与用户 OAuth 不是同一套。
3. 任务可降级时（如群成员同步）优先改 \`--as user\` 继续；只有确实需要 bot 身份时才贴 \`console_url\`。
4. 缺失 scope 从 \`missing_scopes\` 读取，一并告知。`;

/** Short bullets for \`<bridge_instructions>\` in every IM prompt. */
export const BRIDGE_AUTH_INSTRUCTION_BULLETS: readonly string[] = [
  '缺权限时禁止阻塞 auth login --device-code；禁止读代码库找规则。',
  '先判断是否真的缺权限再发链接；@bot/mention 等问题通常不是 scope，不要误发 console_url。',
  '用户 OAuth：p2p 内跑 auth login --no-wait --json，把 verification_url 原样写进本轮正文，不要 --device-code。',
  'bot scope：仅 app_scope_not_applied 时把 console_url 写进本轮正文；bridge 不会另发第二条。',
  '用户授权完成后等「授权好了」或 /lark-auth done，下一轮再继续原任务。',
];
