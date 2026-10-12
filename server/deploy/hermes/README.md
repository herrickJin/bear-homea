# Hermes Agent 部署手册（腾讯云 119.27.191.90）

把 Nous Research 的开源自托管智能体 [Hermes Agent](https://github.com/nousresearch/hermes-agent)
装进 docker-compose（`profiles: ["hermes"]`，默认不影响现有服务），通过 MCP 操作熊熊之家的数据。

> **✅ 2026-10-12 已按本手册完成部署并全链路验证**（模型连通、MCP 8 工具、
> 链接队列 pending→抓取→done 写回）。下文即实际走过的路径。

分工边界（见 `.task-docs/08-ai-assistant.md` 双通道定稿）：

| 通道 | 承载 | 触达 |
|------|------|------|
| server `/api/chat` | App 内实时探讨，同进程读库，页面上下文注入 | UI |
| Hermes 容器（本手册） | 链接队列消费、cron 周报、消息网关 | MCP + 微信/Telegram |

## 0. 前置

- server 容器在跑：`curl -s http://119.27.191.90/api/health` → `{"ok":true}`
- `~/bear-home-server/.env` 有 `BEAR_HOME_TOKEN`
- 智谱 Key（provider zai）：写在 `~/bear-home-server/hermes-data/.env` 的 `GLM_API_KEY=`（bootstrap 会转成 `ZAI_API_KEY` 注入容器）

## 1. 镜像

**服务器直拉即可**（腾讯内网镜像源有缓存，2026-10-12 实测成功）：

```sh
ssh ubuntu@119.27.191.90
sudo docker pull nousresearch/hermes-agent:stable   # ~1.3GB，amd64
```

（镜像源没缓存时才走 Mac 导入：`docker pull --platform linux/amd64 … && docker save … | ssh … 'docker load'`）

## 2. 启动 + 注入配置（bootstrap，幂等可重跑）

**不需要交互式向导**：容器首次启动由镜像 init 自举（生成完整 config/.env 到 `HERMES_HOME=/opt/data`），
模型与 MCP 由 `bootstrap.sh` 注入（模型块走官方 `hermes config set` CLI，MCP 按 config.yaml 文档语法追加）：

```sh
cd ~/bear-home-server
bash scripts/backup.sh                       # 铁律：动容器前先备份
# 部署最新代码（Mac 上 rsync，或 git 拉取后）：
sudo docker compose --profile hermes up -d   # 首次会拉起并自举，等 ~30s
# 智谱 Key 就位（只此一次；也可靠 export GLM_API_KEY=… 传给 bootstrap）：
#   hermes-data/.env 写一行 GLM_API_KEY=…
bash deploy/hermes/bootstrap.sh
sudo docker compose --profile hermes restart hermes
```

## 3. 验证清单（都在服务器上做）

```sh
# 模型连通（应答出字）：
sudo docker exec -u hermes bear-home-server-hermes-1 hermes -z "只回复两个字：正常"
# MCP 工具面（应列出 bear-home ✓ enabled）：
sudo docker exec -u hermes bear-home-server-hermes-1 hermes mcp list
# 链接队列端到端：App 存一条链接（status=pending）→
sudo docker exec -u hermes bear-home-server-hermes-1 hermes -z "按 SOUL 流程处理 bear-home 链接队列"
# → App 里该链接 status=done，title/summary 有真实内容
```

## 4. 实操要点（踩过的坑，都在 2026-10-12 验证）

- **此镜像 `HERMES_HOME=/opt/data`**（不是 `~/.hermes`），compose 只 bind mount
  `./hermes-data:/opt/data`；config.yaml/SOUL.md 不要 ro 挂载覆盖（镜像自管配置，升级不裂）
- **init 会把 hermes-data 整个 chown 成 uid 10000(hermes)**：宿主机 ubuntu 在这目录里
  读写要用 `sudo`；bootstrap 已按此处理
- **provider `zai` 读 `ZAI_API_KEY`**（本地 Mac 装机用的 `GLM_API_KEY` 名字不同）；.env 里两个名都写了
- `hermes config set` 会整文件重写 config.yaml——**先 config set 再追加 MCP 块**（bootstrap 顺序如此）
- `docker exec` 追加文件必须带 `-i`，否则 stdin 不进容器、追加静默空操作
- `${BEAR_HOME_TOKEN}` 在 config.yaml 里保持字面量，由容器 env 运行时展开（compose 已传）
- 资源水位实测：hermes 容器**空闲 ~116MB**，2C/2G 无压力
- 会话内改完 MCP 用 `/reload-mcp`；改 .env/模型要 `restart hermes`

## 5. 微信网关（2026-10-12 已上线：jinmo/xiongxiong 双 profile）

**形态**：微信 iLink 官方机器人机制——扫码绑定一个 `...@im.bot` 机器人身份
（**不是**挂个人微信号，无封号风险）；支持文字/图片/视频/文件；普通微信群拉不进
bot 身份、群事件不推送，只做私聊。DM 准入：pairing / **allowlist（白名单）** / open / disabled。

**多 profile = 多个微信**：每个 profile 一套隔离实例（各自的 .env/记忆/SOUL），
各自扫码绑一个微信。`default` profile 是宿主（gateway 多路复用器从它跑），
jinmo/xiongxiong 是两个真人各自的小熊，都指向同一份 bear-home 数据。

**给某个 profile 配微信**（以 jinmo 为例，全部在服务器上跑）：

```sh
bash deploy/hermes/weixin-login.sh start jinmo     # 出二维码（8 分钟有效），对应人的微信扫+确认
bash deploy/hermes/weixin-login.sh extract jinmo   # 凭证转正进 profile .env（DM 策略=pairing）
# 把对方微信 ID 进白名单（ID 从被拦日志拿：docker logs … | grep Unauthorized）：
#   profile .env 加 WEIXIN_DM_POLICY=allowlist + WEIXIN_ALLOWED_USERS=<id>@im.wechat
sudo docker compose --profile hermes restart hermes
```

**网关常驻**：compose 里 hermes 服务 `command: ["gateway","run"]`（镜像自动转 s6
托管，崩溃自动重启）；多路复用器按 profile 分日志（`hermes-data/logs/gateways/<名>/`）。
首次私聊 bot 会引导 `/sethome` 设家频道（cron 周报投递到这里）。

cron 周报：私聊里自然语言配置（「每周日 20:00 给我发装修进度周报」），SOUL.md 已写格式。

### 网关踩坑（2026-10-12 实测）

- **profile 的 .env 必须自带 `BEAR_HOME_TOKEN`**——config.yaml 的 `${BEAR_HOME_TOKEN}`
  只从该 profile 自己的 .env/secret source 解析，不吃容器环境变量；缺了 MCP 工具全断
  （症状：日志周期性 `Failed to connect to MCP server 'bear-home'`）。bootstrap.sh 已自动注入
- 被 pairing 拦的消息不回复但**会留日志**，微信 ID 就从 `docker logs … | grep Unauthorized` 拿
- `weixin-login.sh extract` 的 docker exec：`-e`/`-i` 选项必须在容器名**之前**，且 `-i` 不可省
  （heredoc 走 stdin）

Telegram（备选）：`hermes gateway setup` 里选，最省事；两家都用就各配各的。

## 6. 升级与回滚

```sh
bash scripts/backup.sh          # 先备份（backup.sh 已含 hermes-data 条件打包）
sudo docker pull nousresearch/hermes-agent:<新tag>
# 改 docker-compose.yml 的 tag → sudo docker compose --profile hermes up -d
# 若新镜像 config schema 变了：重跑 deploy/hermes/bootstrap.sh
```

`hermes-data/` 是 Hermes 的记忆、技能与自学习产物（备份脚本已覆盖）。

## 7. 安全边界

- Hermes 能执行代码：独立容器即隔离边界（**不要再挂 docker.sock 做嵌套沙箱**），
  只经 `http://server:8787/mcp` + Bearer Token 访问数据，不共享 server 文件系统写权限
- 智谱 Key 只存在于各 profile 的 `.env`（600，uid 10000）与 server `.env`（/api/chat 用）；泄露即轮换
- 微信白名单是唯一准入：`WEIXIN_ALLOWED_USERS` 里没有的 ID 一律拒收（日志可查被拦记录）
- MCP 工具面要收紧改 bootstrap.sh 里的 include 列表后重跑
