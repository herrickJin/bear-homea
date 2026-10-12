#!/bin/sh
# 宿主机 hermes 直达包装：自动进容器、自动以 hermes 用户（配置在 uid 10000 的 /opt/data）
# 交互终端（ssh 进服务器直接敲 hermes）→ TUI；脚本/管道里 → 非交互模式
if [ -t 0 ]; then
  exec sudo docker exec -it -u hermes bear-home-server-hermes-1 hermes "$@"
else
  exec sudo docker exec -i -u hermes bear-home-server-hermes-1 hermes "$@"
fi
