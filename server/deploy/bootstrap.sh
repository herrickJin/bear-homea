#!/usr/bin/env bash
# 腾讯云全新 Ubuntu 24.04 一键初始化 + 部署 bear-home-server
# 前提：代码已 rsync 到 ~/bear-home-server，本机在服务器上执行
set -euo pipefail

APP_DIR="$HOME/bear-home-server"

echo "== 1/4 安装 Docker（Ubuntu 腾讯内网 apt 源，速度快）=="
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y docker.io docker-compose-v2
fi
sudo systemctl enable --now docker

echo "== 2/4 配置镜像加速 =="
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com",
    "https://docker.m.daocloud.io"
  ]
}
EOF
sudo systemctl restart docker
sudo usermod -aG docker "$USER" || true

echo "== 3/4 生成配置 .env =="
cd "$APP_DIR"
if [ ! -f .env ]; then
  TOKEN="bh-$(openssl rand -hex 24)"
  cat > .env <<EOF
BEAR_HOME_TOKEN=$TOKEN
PORT=8787
DATA_DIR=./data
EOF
  echo "已生成随机 Token"
fi

echo "== 4/4 构建并启动 =="
sudo -E docker compose up -d --build

sleep 3
echo
echo "================ 部署完成 ================"
echo "健康检查: curl http://127.0.0.1/api/health"
echo "Bearer Token（妥善保管，连不上的服务都靠它）:"
grep BEAR_HOME_TOKEN .env
echo "后续设置域名 HTTPS：编辑 .env 加 BEAR_HOME_DOMAIN=你的域名，再 sudo docker compose up -d"
