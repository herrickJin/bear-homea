#!/bin/sh
# bear-home 容器内开发 → 宿主机自动部署的 SSH 强制命令（forced command）。
#
# 配置方法（宿主机 ubuntu 用户，一次性）：
#   bash ~/bear-home-server/hermes-data/profiles/coder/bear-homea/server/deploy/setup-deploy-hook.sh
#   （详见该脚本头部注释）
#
# 作用：密钥只能触发本脚本，不能开 shell。脚本从 stdin 读 JSON 指令：
#   {"op":"deploy","what":"server"}  备份→rsync server/ →重建并重启 server 容器
#   {"op":"deploy","what":"web"}     rsync H5 产物到 caddy ./web（前端改动）
#   {"op":"status"}                  查看容器状态
#   {"op":"backup"}                  手动触发一次备份
#
# 路径约定：
#   容器内 /opt/data = 宿主机 ~/bear-home-server/hermes-data/（compose 卷挂载）
#   → 容器内 clone 的仓库宿主机天然可见，无需 git 中转：
#   /opt/data/profiles/coder/bear-homea ↔ ~/bear-home-server/hermes-data/profiles/coder/bear-homea
#
#   生产 compose 项目在 ~/bear-home-server/（不是仓库目录！直接在仓库里 up 会起第二套栈），
#   所以部署 = 先把仓库 server/ rsync 到生产目录（保住 data/web/hermes-data/.env），
#   再在生产目录里 build。与 .task-docs/01 记录的人工流程一致，只是自动化了。

set -eu

REPO="$HOME/bear-home-server/hermes-data/profiles/coder/bear-homea"
PROD="$HOME/bear-home-server"
LOG="$HOME/bear-home-deploy.log"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

cmd=$(cat)

case "$cmd" in
  *'"op":"deploy"'*|*'"op": "deploy"'*) op="deploy" ;;
  *'"op":"status"'*|*'"op": "status"'*) op="status" ;;
  *'"op":"backup"'*|*'"op": "backup"'*) op="backup" ;;
  *) echo "未知指令"; exit 1 ;;
esac

case "$op" in
  status)
    log "status 查询"
    sudo docker ps --filter "name=bear-home" --format "{{.Names}}: {{.Status}}"
    exit 0
    ;;
  backup)
    log "手动备份"
    # 备份脚本走仓库最新版（$REPO）而非 $PROD 已部署版：
    # $PROD 版本的源头本来也是 rsync 自 $REPO，信任模型相同；
    # 但走 $REPO 后修 bug 立即生效——否则出现过死锁：有 bug 的自检先 rsync 进 $PROD，
    # 「先备份后 rsync」的顺序让备份必失败、修复永远送不进去（2026-10-12 实测）。
    sh "$REPO/server/scripts/backup.sh"
    exit 0
    ;;
esac

# deploy server：必经备份（数据安全优先；backup.sh 内部走容器内 better-sqlite3 在线快照）
log "deploy 开始：先备份"
sh "$REPO/server/scripts/backup.sh" || { log "备份失败，中止部署"; exit 1; }

what=$(echo "$cmd" | sed -n 's/.*"what": *"\([a-z]*\)".*/\1/p')

case "$what" in
  server)
    log "deploy server：rsync 代码到生产目录"
    # 生产目录里的运行时资产绝不触碰；--delete 只清理仓库管理的代码文件
    rsync -a --delete \
      --exclude data --exclude web --exclude hermes-data --exclude .env \
      --exclude node_modules --exclude dist \
      "$REPO/server/" "$PROD/"
    log "deploy server：重建镜像并重启"
    cd "$PROD"
    sudo docker compose up -d --build server
    sudo docker compose up -d caddy
    ;;
  web)
    log "deploy web：同步 H5 产物（容器内已构建）"
    rsync -a --delete "$REPO/bear-home/dist/h5/" "$PROD/web/"
    ;;
  *)
    echo "未知部署目标：$what（可选 server / web）"
    exit 1
    ;;
esac

log "deploy 完成"
