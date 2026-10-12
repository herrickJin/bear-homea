#!/bin/sh
# bear-home 部署客户端：Hermes 容器内执行，通过 SSH forced command 触发宿主机部署。
# 用法：
#   ./scripts/deploy.sh server   # 后端改动：备份 → docker compose up -d --build server
#   ./scripts/deploy.sh web      # 前端改动：容器内 build:h5 → rsync 产物到宿主机 ./web
#   ./scripts/deploy.sh status   # 看容器状态
#   ./scripts/deploy.sh backup   # 手动备份
# 首次配置见 server/deploy/deploy-hook.sh 头部注释（宿主机 authorized_keys 一次性设置）。

set -eu

REPO="$(cd "$(dirname "$0")/.." && pwd)"
KEY="/opt/data/profiles/coder/home/.ssh/bear_deploy"
HOST="ubuntu@172.18.0.1"

what="${1:-}"

# 前端部署：产物必须在容器内先构建（宿主机 hook 只做 rsync）
if [ "$what" = "web" ]; then
  echo "==> 构建 H5 产物..."
  (cd "$REPO/bear-home" && npm run build:h5)
  echo "==> 构建完成，触发宿主机同步..."
fi

payload=''
case "$what" in
  server|web) payload="{\"op\":\"deploy\",\"what\":\"$what\"}" ;;
  status) payload='{"op":"status"}' ;;
  backup) payload='{"op":"backup"}' ;;
  *) echo "用法: $0 server|web|status|backup"; exit 1 ;;
esac

echo "$payload" | ssh -i "$KEY" \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  -o ConnectTimeout=10 \
  "$HOST" 2>&1
