#!/usr/bin/env bash
# bear-home 数据备份 —— 在部署服务器（ubuntu 用户）上运行。
#
# 产出（~/bear-home-backups/，在 data/ 之外，防误删连坐）：
#   bear-home-<时间戳>.db    SQLite 一致性快照。经容器内 better-sqlite3 .backup()
#                            在线生成，自动并含 WAL 中的数据——本项目 WAL 常驻，
#                            直接 cp 主库文件会丢掉大部分数据，切勿用 cp 备份。
#   files-<时间戳>.tar.gz    上传文件（用户截图 + 封面转存，即 data/files/）。
#                            库里的 shot_url/cover_url 指向这些文件，必须与库同备份。
#   hermes-<时间戳>.tar.gz   Hermes 数据（配置/记忆/技能/会话库/仓库源码）。
#                            排除可再生大目录（installs/node_modules/npm·构建缓存/lsp，
#                            约 2.6GB——镜像 init 可重建、npm install 可重装），
#                            体积从全量 ~950MB 降到 ~130MB，部署前自动备份不再拖 3 分钟。
#
# 恢复步骤：
#   cd ~/bear-home-server && docker compose stop server
#   cp ~/bear-home-backups/bear-home-<stamp>.db data/bear-home.db
#   rm -f data/bear-home.db-wal data/bear-home.db-shm
#   tar -xzf ~/bear-home-backups/files-<stamp>.tar.gz -C data/
#   sudo chown -R root:root data/   # 容器以 root 写入 data/
#   docker compose start server
#   # Hermes 数据恢复（容器内路径 /opt/data）：
#   # tar -xzf ~/bear-home-backups/hermes-<stamp>.tar.gz -C ~/bear-home-server/hermes-data/
#
# 升级/重建容器前务必手动先跑一次：./backup.sh
set -euo pipefail

CONTAINER="${CONTAINER:-bear-home-server-server-1}"
DATA="${DATA:-$HOME/bear-home-server/data}"
DEST="${DEST:-$HOME/bear-home-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
KEEP="${KEEP:-14}"

mkdir -p "$DEST"

# 1) SQLite 一致性快照：在容器内执行（那里有 better-sqlite3），落 /data/backups
#    （即宿主机 data/backups）后取回到 DEST，快照经 quick_check 校验才算成功。
docker exec "$CONTAINER" node -e '
  const Database = require("better-sqlite3");
  const fs = require("fs");
  const staged = "/data/backups/bear-home-" + process.argv[1] + ".db";
  fs.mkdirSync("/data/backups", { recursive: true });
  Database("/data/bear-home.db").backup(staged).then(() => {
    const check = Database(staged, { readonly: true });
    const ok = check.pragma("quick_check", { simple: true });
    if (ok !== "ok") throw new Error("quick_check: " + ok);
    console.log("快照完成且校验通过:", staged);
  }).catch((e) => { console.error(e); process.exit(1); });
' "$STAMP"

sudo cp "$DATA/backups/bear-home-$STAMP.db" "$DEST/"
sudo rm -f "$DATA/backups/bear-home-$STAMP.db"
sudo chown "$(id -un):$(id -gn)" "$DEST/bear-home-$STAMP.db"

# 2) 上传文件打包（截图 / 封面转存；库里的 shot_url/cover_url 指向这里）
sudo tar -czf "$DEST/files-$STAMP.tar.gz" -C "$DATA" files
sudo chown "$(id -un):$(id -gn)" "$DEST/files-$STAMP.tar.gz"

# 3) Hermes 的记忆与技能目录（启用 hermes profile 后才存在；没有则跳过）
HERMES_DATA="${HERMES_DATA:-$HOME/bear-home-server/hermes-data}"
if [ -d "$HERMES_DATA" ]; then
  # 排除可再生大目录（GNU tar --exclude 默认任意层级匹配，已实测）：
  #   installs 1.5G 工具链（镜像 init 可重建）· node_modules 810M（npm i 可重装）
  #   .npm/.cache/cache ~350M 构建缓存 · lsp 56M 语言服务 · models_dev_cache.json
  #   *.sock 运行时套接字（顺带消掉大部分 file changed 告警）
  # 要保住的：config/SOUL/memories/skills/cron/vault/auth/会话库/各 profile .env/仓库源码
  # agent 可能在写文件：GNU tar 会报 file changed 并以非零码退出——产物保留但告警
  if sudo tar -czf "$DEST/hermes-$STAMP.tar.gz" \
    --exclude=installs \
    --exclude=node_modules \
    --exclude=.npm \
    --exclude=.cache \
    --exclude=cache \
    --exclude=lsp \
    --exclude=models_dev_cache.json \
    --exclude='*.sock' \
    -C "$HERMES_DATA" .; then
    sudo chown "$(id -un):$(id -gn)" "$DEST/hermes-$STAMP.tar.gz"
  else
    echo "警告：hermes-data 打包期间文件有变动（agent 运行中），产物可能不完整"
  fi
fi

# 4) hermes 产物自检：关键资产必须在、可再生大目录必须不在。
#    自检不过 = 备份不可信 → 非零退出 → deploy-hook 联动中止部署（宁可不发版也不带病跑）。
if [ -f "$DEST/hermes-$STAMP.tar.gz" ]; then
  LIST="$(tar -tzf "$DEST/hermes-$STAMP.tar.gz")" || { echo "备份自检失败：tar 无法列举（产物损坏）" >&2; exit 1; }
  missing=""
  for p in ./config.yaml ./SOUL.md ./state.db ./auth.json ./cron/ \
    ./profiles/coder/.env ./profiles/coder/SOUL.md \
    ./profiles/coder/bear-homea/.git/HEAD \
    ./profiles/coder/bear-homea/server/src/index.ts; do
    printf '%s\n' "$LIST" | grep -qxF "$p" || missing="$missing $p"
  done
  if printf '%s\n' "$LIST" | grep -qE '(^|/)(installs|node_modules)(/|$)'; then
    echo "备份自检失败：产物混入可再生大目录（排除规则失效）" >&2
    exit 1
  fi
  if [ -n "$missing" ]; then
    echo "备份自检失败：缺少关键资产:$missing" >&2
    exit 1
  fi
  echo "hermes 备份自检通过（关键资产齐全、大目录已排除，条目 $(printf '%s' "$LIST" | wc -l)）"
fi

# 5) 滚动保留最近 KEEP 份
ls -1t "$DEST"/bear-home-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f || true
ls -1t "$DEST"/files-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f || true
ls -1t "$DEST"/hermes-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f || true

echo "备份完成 → $DEST（保留 $KEEP 份）"
ls -lht "$DEST" | head -5
