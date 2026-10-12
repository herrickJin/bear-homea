#!/usr/bin/env bash
# Hermes 注入配置（在部署服务器上跑，幂等可重复执行）：
#   1. GLM Key → /opt/data/.env（ZAI_API_KEY，provider zai 读取；经容器环境变量传递，不进 argv）
#   2. 模型块 → hermes config set（provider zai / glm-5.3 / 智谱 coding 端点）
#   3. MCP bear-home → 按 config.yaml 的 mcp_servers 文档语法追加（${BEAR_HOME_TOKEN} 运行时展开）
#   4. SOUL.md → 小熊人设覆盖
# 镜像升级后配置 schema 若变，只需重跑本脚本。
#
# 前置：GLM_API_KEY 已在 ~/bear-home-server/hermes-data/.env（首次）或 export GLM_API_KEY=… 后执行
# 用法：bash ~/bear-home-server/deploy/hermes/bootstrap.sh
set -euo pipefail

DIR="${BEAR_HOME_DIR:-$HOME/bear-home-server}"
HERMES_DATA="${HERMES_DATA:-$DIR/hermes-data}"
CONTAINER="${HERMES_CONTAINER:-bear-home-server-hermes-1}"
HERMES_UID_GID="10000:10000"

hrun() { sudo docker exec -u hermes "$CONTAINER" "$@"; }

# 1) Key → 容器 .env（ZAI_API_KEY 是本镜像 provider zai 的读取名；GLM_API_KEY 一并写入作别名）
#    hermes-data 属 10000（容器 hermes 用户），宿主机读取要 sudo
KEY="${GLM_API_KEY:-$(sudo grep -m1 -o '^GLM_API_KEY=.*' "$HERMES_DATA/.env" 2>/dev/null | cut -d= -f2- || true)}"
if [ -z "$KEY" ]; then
  KEY="$(sudo grep -m1 -o '^ZAI_API_KEY=.*' "$HERMES_DATA/.env" 2>/dev/null | cut -d= -f2- || true)"
fi
if [ -z "$KEY" ]; then
  echo "错误：未找到 GLM_API_KEY —— 写进 $HERMES_DATA/.env（GLM_API_KEY=…）后重跑" >&2
  exit 1
fi
sudo docker exec -u hermes -e ZAI_KEY_IN="$KEY" "$CONTAINER" sh -c '
  grep -v -e "^ZAI_API_KEY=" -e "^GLM_API_KEY=" -e "^GLM_BASE_URL=" -e "^HERMES_TIMEZONE=" /opt/data/.env > /opt/data/.env.new || true
  printf "ZAI_API_KEY=%s\nGLM_API_KEY=%s\nGLM_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4\nHERMES_TIMEZONE=Asia/Shanghai\n" \
    "$ZAI_KEY_IN" "$ZAI_KEY_IN" >> /opt/data/.env.new
  mv /opt/data/.env.new /opt/data/.env
'
echo "✓ .env 已注入（ZAI_API_KEY 等 4 项）"

# 2) 模型块（与 Mac 本地已验证配置同构）
hrun hermes config set model.default glm-5.3 >/dev/null
hrun hermes config set model.provider zai >/dev/null
hrun hermes config set model.base_url https://open.bigmodel.cn/api/coding/paas/v4 >/dev/null 2>&1 \
  || sudo docker exec -u hermes "$CONTAINER" hermes config set --force model.base_url https://open.bigmodel.cn/api/coding/paas/v4 >/dev/null
echo "✓ 模型：$(hrun hermes config get model | tr '\n' ' ')"

# 3) MCP bear-home（幂等：已有则跳过；${BEAR_HOME_TOKEN} 保持字面量，由容器 env 运行时展开）
if hrun hermes mcp list 2>/dev/null | grep -q "bear-home"; then
  echo "✓ MCP bear-home 已存在，跳过"
else
  # -i 必须：否则 docker exec 不收 stdin，追加会静默空操作
  sudo docker exec -i -u hermes "$CONTAINER" sh -c 'cat >> /opt/data/config.yaml' <<'YAML'

mcp_servers:
  bear-home:
    url: "http://server:8787/mcp"
    headers:
      Authorization: "Bearer ${BEAR_HOME_TOKEN}"
    tools:
      include:
        - list_entries
        - search_entries
        - get_entry
        - create_entry
        - list_links
        - get_link
        - save_link
        - update_link
YAML
  echo "✓ MCP bear-home 已写入 config.yaml"
fi

# 4) SOUL.md（小熊人设）
sudo cp "$DIR/deploy/hermes/SOUL.md" "$HERMES_DATA/SOUL.md"
sudo chown "$HERMES_UID_GID" "$HERMES_DATA/SOUL.md"
echo "✓ SOUL.md 已就位"

echo "完成。重载方式：sudo docker compose --profile hermes restart hermes（或会话内 /reload-mcp）"
