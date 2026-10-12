#!/usr/bin/env bash
# Hermes 注入配置（在部署服务器上跑，幂等可重复执行）。
# 用法：bash bootstrap.sh [profile]      # 缺省 default（/opt/data 根）；命名 profile 写 /opt/data/profiles/<名>/
#
# 每个 profile 注入：模型（zai/glm-5.3/coding 端点）+ MCP（bear-home）+ SOUL.md + GLM Key。
# 镜像升级后 config schema 若变，重跑本脚本即可。
#
# 前置：GLM Key 已在宿主机 hermes-data/.env（GLM_API_KEY=…）
set -euo pipefail

DIR="${BEAR_HOME_DIR:-$HOME/bear-home-server}"
CONTAINER="${HERMES_CONTAINER:-bear-home-server-hermes-1}"
HERMES_UID_GID="10000:10000"
P="${1:-default}"

if [ "$P" = "default" ]; then
  HOME_DIR="/opt/data"
  hrun() { sudo docker exec -u hermes "$CONTAINER" hermes "$@"; }
else
  HOME_DIR="/opt/data/profiles/$P"
  hrun() { sudo docker exec -u hermes "$CONTAINER" hermes -p "$P" "$@"; }
  if ! sudo docker exec -u hermes "$CONTAINER" test -d "$HOME_DIR"; then
    echo "错误：profile $P 不存在（hermes profile create $P 先建）" >&2
    exit 1
  fi
fi

# 1) 模型块（OpenAI 兼容端点 + 智谱；默认 glm-5.3-flash，可用 HERMES_MODEL 覆盖）
MODEL="${HERMES_MODEL:-glm-5.3-flash}"
hrun config set model.default "$MODEL" >/dev/null
hrun config set model.provider zai >/dev/null
hrun config set model.base_url https://open.bigmodel.cn/api/coding/paas/v4 >/dev/null 2>&1 || true
echo "[$P] ✓ 模型：$(hrun config get model | tr '\n' ' ')"

# 2) GLM Key → profile 的 .env（从主 hermes-data/.env 读，sudo 必需——属 uid 10000）
KEY="$(sudo grep -m1 -o '^GLM_API_KEY=.*' "$DIR/hermes-data/.env" 2>/dev/null | cut -d= -f2- || true)"
if [ -z "$KEY" ]; then
  KEY="$(sudo grep -m1 -o '^ZAI_API_KEY=.*' "$DIR/hermes-data/.env" 2>/dev/null | cut -d= -f2- || true)"
fi
if [ -z "$KEY" ]; then
  echo "错误：主 .env 里没有 GLM_API_KEY" >&2
  exit 1
fi
sudo docker exec -u hermes -e ZAI_KEY_IN="$KEY" -e HOME_DIR="$HOME_DIR" "$CONTAINER" sh -c '
  touch "$HOME_DIR/.env"
  grep -v -e "^ZAI_API_KEY=" -e "^GLM_API_KEY=" -e "^GLM_BASE_URL=" -e "^HERMES_TIMEZONE=" "$HOME_DIR/.env" > "$HOME_DIR/.env.new" || true
  printf "ZAI_API_KEY=%s\nGLM_API_KEY=%s\nGLM_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4\nHERMES_TIMEZONE=Asia/Shanghai\n" \
    "$ZAI_KEY_IN" "$ZAI_KEY_IN" >> "$HOME_DIR/.env.new"
  mv "$HOME_DIR/.env.new" "$HOME_DIR/.env"
'
echo "[$P] ✓ .env 已注入（ZAI_API_KEY 等 4 项）"

# 3) MCP bear-home（幂等；${BEAR_HOME_TOKEN} 保持字面量，容器 env 运行时展开）
if hrun mcp list 2>/dev/null | grep -q "bear-home"; then
  echo "[$P] ✓ MCP bear-home 已存在，跳过"
else
  # -i 必须：否则 docker exec 不收 stdin，追加会静默空操作；路径经位置参数传入，不在 sh -c 里拼串
  sudo docker exec -i -u hermes "$CONTAINER" sh -c 'cat >> "$1"' sh "$HOME_DIR/config.yaml" <<'YAML'

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
  echo "[$P] ✓ MCP bear-home 已写入 config.yaml"
fi

# 4) SOUL.md（小熊人设）
if [ "$P" = "default" ]; then
  sudo cp "$DIR/deploy/hermes/SOUL.md" "$DIR/hermes-data/SOUL.md"
else
  sudo cp "$DIR/deploy/hermes/SOUL.md" "$DIR/hermes-data/profiles/$P/SOUL.md"
fi
sudo chown -R "$HERMES_UID_GID" "$DIR/hermes-data"
echo "[$P] ✓ SOUL.md 已就位"
echo "[$P] 完成。"
