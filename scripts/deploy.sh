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

# 权限链防重置：Hermes 的 profile 操作可能把 profiles/coder 收回 700，
# 宿主机就进不来了。每次部署前幂等放开（穿透不列目 + 仓库树可读）。
chmod o+x /opt/data /opt/data/profiles /opt/data/profiles/coder 2>/dev/null || true
chmod -R o+rX "$REPO" 2>/dev/null || true

# 前端部署：产物必须在容器内先构建（宿主机 hook 只做 rsync）
if [ "$what" = "web" ]; then
  echo "==> 构建 H5 产物..."
  (cd "$REPO/bear-home" && npm run build:h5)
  # 新生成的 dist 目录对宿主机必须可读
  chmod -R o+rX "$REPO/bear-home/dist" 2>/dev/null || true
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
