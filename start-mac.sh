#!/usr/bin/env bash
# macOS 启动脚本：加载 .env + 切 Node 22 + 前台运行 bridge
# 用法：
#   ./start-mac.sh                                   # 首次会走扫码建飞书 app
#   ./start-mac.sh --app-id <id> --app-secret <secret>   # 用已有飞书自建应用
set -euo pipefail

cd "$(dirname "$0")"

# 切到 Node 20+（用 nvm 装的 v22）
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || true
fi

# 加载 .env（KEY=VALUE，忽略注释/空行）
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${CURSOR_API_KEY:-}" ] || [ "${CURSOR_API_KEY}" = "cursor_" ]; then
  echo "[ERROR] 请先在 .env 里填好 CURSOR_API_KEY" >&2
  exit 1
fi

# 默认 profile=cursor、agent=cursor，多余参数透传给 CLI
exec node bin/lark-channel-bridge.mjs run --agent cursor "$@"
