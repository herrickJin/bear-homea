# 10 · 开发-部署链路（coder 容器直发生产）

> 2026-10-12 立项并完成。背景：coder profile 长期驻留在部署服务器的 Hermes 容器里
> 开发，此前每次上线都要屋主手动 rsync + docker compose；本任务把它变成
> 改完代码一条命令直发。与 01（后端+部署）、03（Hermes 接入）衔接。

## 0. 环境结论（实测，勿凭想象）

- coder 容器 `172.18.0.4`，与生产 `server` 容器同 docker 网络，`http://server:8787` 直达；
  公网出口 `119.27.191.90`
- `/opt/data`（容器内）= 宿主机 `~/bear-home-server/hermes-data/`（compose 卷挂载）→
  **容器内 clone 的仓库宿主机天然可见，部署不需要 git 中转**
- 生产 compose 项目在宿主机 `~/bear-home-server/`——直接在仓库目录 `up` 会起第二套栈（禁）
- 容器无 docker.sock、无 sudo、无 GitHub 凭据；宿主机 `hermes-data/` 属 uid 10000、
  初始 700 → 宿主机 ubuntu（uid 1000）默认进不去

## 1. 通道设计：SSH forced command

```
容器内 ./scripts/deploy.sh server|web|status|backup
  └─ ssh -i bear_deploy ubuntu@172.18.0.1（stdin 传 JSON 指令）
       └─ authorized_keys 强制绑定 ~/deploy-hook.sh（no-pty/no 转发，密钥开不了 shell）
            ├─ status/backup：直通
            └─ deploy：先 backup.sh 在线快照（失败即中止）→ rsync 到生产目录
                        → docker compose up -d --build server（web 则 rsync 产物到 ./web）
```

| 组件 | 位置 | 职责 |
|---|---|---|
| `scripts/deploy.sh` | 仓库（容器内跑） | 客户端；web 先容器内 build:h5；**每次部署前幂等放开权限链** |
| `server/deploy/deploy-hook.sh` | 仓库（源）→ 宿主机 `~/deploy-hook.sh`（装） | 宿主机侧执行器，白名单 JSON 指令 |
| `server/deploy/setup-deploy-hook.sh` | 仓库（宿主机 ubuntu 跑一次） | 装 hook + 登记 forced-command 公钥；防 sudo/root 误用 |
| `.ssh/bear_deploy` | 容器 `/opt/data/profiles/coder/home/.ssh/` | ed25519 部署密钥（私钥不出容器） |

安全边界：密钥仅能触发固定脚本；hook 只读写白名单路径（生产目录的
`data/web/hermes-data/.env` 运行时资产全程排除）；备份失败即拒绝部署。

## 2. 一次性配置记录（2026-10-12 屋主完成）

1. `setup-deploy-hook.sh` 以 **ubuntu** 用户执行（`sudo bash` 会把 `$HOME` 切成 `/root`——
   脚本已加 root 拒绝防呆；提示符 `root@` 时先 `exit`）
2. `/etc/sudoers.d/bear-deploy`：`ubuntu ALL=(ALL) NOPASSWD: /usr/bin/docker`
3. 权限链：`chmod o+x /opt/data /opt/data/profiles /opt/data/profiles/coder` +
   仓库树 `o+rX`——注意 Hermes profile 操作可能把 `profiles/coder` 收回 700，
   故 deploy.sh 每次部署前自动补

## 3. 踩坑记录

| 坑 | 根因 | 修法 |
|---|---|---|
| setup 路径 `/root/...` 找不到 | sudo/root 下 `$HOME` 变 `/root` | 脚本 root 拒绝 + 指令注明 ubuntu 用户 |
| rsync `Permission denied` | `hermes-data/` 700 且 profiles/coder 被 profile 操作重置 | 权限链幂等放开（进 deploy.sh） |
| Docker 构建 node-gyp 找不到 Python | better-sqlite3@13 带 `binding.gyp`，npm 见之自动 node-gyp，runtime stage 无 python3 | runtime `npm ci --omit=dev --ignore-scripts`（v13 自带 prebuilds） |
| 本地跑通 ≠ Docker 能过 | 本机容器恰有 python3 | 改依赖必真跑一次 `deploy.sh server` |

## 4. 验证记录（2026-10-12 全通过）

- `deploy.sh server`：备份→rsync→镜像重建→滚动重启；health/401/建删记录/公网 全绿
- `deploy.sh web`：build:h5→rsync；**生产 5 个关键文件（app.js/232.js/chunk/143.js/app.css/index.html）与本地构建 sha256 逐一比对一致**；chunk 内 API base/token 烘烤正确；生产数据完好（3 条笔记）
- 手机端修复（白屏、详情页关闭钮）随本次 web 部署一并上线

## 5. 遗留

- **git push 未通**：容器无 GitHub 凭据（vault 空），本地领先 origin 7 个 commit；
  部署不依赖 push，待配 token/deploy key 后同步
- 备份含 hermes-data 全量打包（约 950MB/3 分钟），拖慢每次部署；后续可考虑
  排除 `cache/state` 等易变大目录，或仅 server 部署时备份 db+files
