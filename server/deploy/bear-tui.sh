#!/bin/sh
# 熊熊之家 Hermes TUI 直达入口（部署为服务器 /usr/local/bin/bear）
# 用法：ssh -t ubuntu@119.27.191.90 bear
#   或：ssh -t ubuntu@119.27.191.90 "bear --resume latest"   # 接着上次聊
exec sudo docker exec -it -u hermes bear-home-server-hermes-1 hermes --tui "$@"
