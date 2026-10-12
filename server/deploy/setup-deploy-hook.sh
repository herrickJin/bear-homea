#!/usr/bin/env bash
# deploy-hook 一次性配置（在部署服务器宿主机上跑，幂等可重复）：
#
#   ssh -t ubuntu@119.27.191.90
#   bash ~/bear-home-server/hermes-data/profiles/coder/bear-homea/server/deploy/setup-deploy-hook.sh
#
# 做三件事：
#   1. 把 deploy-hook.sh 安装为 ~/deploy-hook.sh（宿主机属主，容器内不可改）
#   2. 把 Hermes coder 容器的部署公钥以 forced command 方式登记进 authorized_keys
#      —— 该密钥只能触发部署脚本，不能开 shell / 转发端口
#   3. 打印验证方法
set -euo pipefail

# 防 sudo 误用：sudo bash 会把 $HOME 切成 /root，路径全错。
# 本脚本只写 ubuntu 用户自己的文件（~/deploy-hook.sh、~/.ssh/authorized_keys），无需 root。
if [ "$(id -u)" = "0" ]; then
  echo "错误：请勿用 sudo 运行（\$HOME 会变成 /root 导致路径全错）。" >&2
  echo "直接运行：bash ~/bear-home-server/hermes-data/profiles/coder/bear-homea/server/deploy/setup-deploy-hook.sh" >&2
  exit 1
fi

REPO="$HOME/bear-home-server/hermes-data/profiles/coder/bear-homea"
HOOK="$HOME/deploy-hook.sh"
AUTH_KEYS="$HOME/.ssh/authorized_keys"
PUBKEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEgOhq/BMc88MQYQ3B42UnOjOU9PgQJgfJ7hq6RPVMoQ bear-coder-deploy'

[ -f "$REPO/server/deploy/deploy-hook.sh" ] || { echo "找不到 $REPO/server/deploy/deploy-hook.sh" >&2; exit 1; }

# 1) 安装 hook（每次重跑都会刷新到仓库最新版）
install -m 755 "$REPO/server/deploy/deploy-hook.sh" "$HOOK"
echo "✓ 已安装 $HOOK"

# 2) 登记公钥（幂等：已存在则跳过）
mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"; touch "$AUTH_KEYS"; chmod 600 "$AUTH_KEYS"
if grep -qF "bear-coder-deploy" "$AUTH_KEYS" 2>/dev/null; then
  echo "✓ 公钥已登记（跳过）"
else
  printf 'command="%s",no-port-forwarding,no-x11-forwarding,no-agent-forwarding,no-pty %s\n' \
    "$HOOK" "$PUBKEY" >> "$AUTH_KEYS"
  echo "✓ 已登记部署公钥（forced command only）"
fi

# 3) 验证提示
cat <<EOF

完成。之后在 Hermes 容器内（coder）即可自主部署：
  ~/bear-homea/scripts/deploy.sh status    # 查容器状态
  ~/bear-homea/scripts/deploy.sh server    # 备份→重建后端
  ~/bear-homea/scripts/deploy.sh web       # 构建前端→同步产物

注意：hook 里用了 sudo docker；若 ubuntu 的 sudo 需要密码，请先配置 NOPASSWD：
  sudo visudo   # 加一行：ubuntu ALL=(ALL) NOPASSWD: /usr/bin/docker
EOF
