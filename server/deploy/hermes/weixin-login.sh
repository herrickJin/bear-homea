#!/usr/bin/env bash
# 微信（iLink 机器人）扫码登录辅助（在部署服务器上跑，支持指定 profile）。
# 流程：后台起 qr_login → 二维码实时打在该 profile 的 weixin-qr.log → 微信扫码确认后
# 凭证 JSON 出现在日志尾行（@@ 开头），extract 模式转正为该 profile .env 的 WEIXIN_* 配置。
# 密钥只进容器内 .env，不落仓库。
#
# 用法：
#   bash weixin-login.sh start [profile]    # 启动扫码（缺省 default；二维码 8 分钟内有效）
#   bash weixin-login.sh show  [profile]    # 再看一次二维码
#   bash weixin-login.sh extract [profile]  # 扫完确认后，把凭证转正进该 profile 的 .env
set -euo pipefail

CONTAINER="${HERMES_CONTAINER:-bear-home-server-hermes-1}"
P="${2:-default}"
if [ "$P" = "default" ]; then
  HOME_DIR="/opt/data"
else
  HOME_DIR="/opt/data/profiles/$P"
fi
WXE() { sudo docker exec -u hermes "$CONTAINER" "$@"; }

case "${1:-}" in
  start)
    echo "→ [$P] 启动扫码登录（二维码 8 分钟内有效）…"
    sudo docker exec -d -u hermes -e HOME_DIR="$HOME_DIR" "$CONTAINER" sh -c "python -c \"
import asyncio, json, os
from gateway.platforms.weixin import qr_login
creds = asyncio.run(qr_login(os.environ['HOME_DIR']))
print('@@' + json.dumps(creds or {}))
\" > \"$HOME_DIR/weixin-qr.log\" 2>&1"
    sleep 4
    WXE cat "$HOME_DIR/weixin-qr.log"
    echo
    echo "→ [$P] 用对应人的微信扫上面的二维码并在手机确认。完成后运行：bash $0 extract $P"
    ;;
  show)
    WXE cat "$HOME_DIR/weixin-qr.log"
    ;;
  extract)
    LINE="$(WXE sh -c 'grep -a "^@@" "$1" | tail -1' sh "$HOME_DIR/weixin-qr.log" || true)"
    if [ -z "$LINE" ]; then
      echo "[$P] 还没扫完（日志里没有凭证行）。先 bash $0 show $P 看状态，扫完确认后再试。" >&2
      exit 1
    fi
    # 注意：docker exec 的 -e/-i 选项必须在容器名之前；-i 必须（heredoc 走 stdin）
    sudo docker exec -i -u hermes -e WX_LINE="$LINE" -e HOME_DIR="$HOME_DIR" "$CONTAINER" python - <<'PY'
import json, os
raw = os.environ["WX_LINE"][2:]
creds = json.loads(raw)
if not creds.get("account_id") or not creds.get("token"):
    raise SystemExit("凭证不完整，重跑 start 再扫一次")
env_path = os.path.join(os.environ["HOME_DIR"], ".env")
try:
    with open(env_path) as f:
        env = [l for l in f.read().splitlines() if not l.startswith("WEIXIN_")]
except FileNotFoundError:
    env = []
env += [
    "WEIXIN_ACCOUNT_ID=" + creds["account_id"],
    "WEIXIN_TOKEN=" + creds["token"],
]
if creds.get("base_url"):
    env.append("WEIXIN_BASE_URL=" + creds["base_url"])
env.append("WEIXIN_CDN_BASE_URL=" + str(creds.get("cdn_base_url") or "https://novac2c.cdn.weixin.qq.com/c2c"))
env += ["WEIXIN_DM_POLICY=pairing", "WEIXIN_ALLOW_ALL_USERS=false"]
with open(env_path, "w") as f:
    f.write("\n".join(env) + "\n")
print("✓ WEIXIN_* 已写入 .env（DM 策略=pairing，新私聊需配对批准）")
print("✓ account_id 尾号:", creds["account_id"][-6:])
PY
    ;;
  *)
    echo "用法: bash $0 {start|show|extract} [profile]" >&2
    exit 1
    ;;
esac
