# Hermes Agent 部署手册（腾讯云 119.27.191.90）

把 Nous Research 的开源自托管智能体 [Hermes Agent](https://github.com/nousresearch/hermes-agent)
装进 docker-compose（`profiles: ["hermes"]`，默认不影响现有服务），通过 MCP 操作熊熊之家的数据。

分工边界（2026-10-12 定稿，见 `.task-docs/08-ai-assistant.md`）：

| 通道 | 承载 | 触达 |
|------|------|------|
| server `/api/chat`（本仓库已实现） | App 内实时探讨，同进程读库，页面上下文注入 | UI |
| Hermes 容器（本手册） | 链接队列消费、cron 周报、消息网关 | MCP + 微信/Telegram |

## 0. 前置

- server 容器已在跑：`curl -s http://119.27.191.90/api/health` → `{"ok":true}`
- `~/bear-home-server/.env` 里有 `BEAR_HOME_TOKEN`（MCP 鉴权用）
- 服务器 2C/2G，基线内存已用 ~600MB；Hermes 镜像 ~1.3GB（amd64），确认磁盘余量

## 1. 获取镜像（国内 Docker Hub 不可达，从 Mac 手动导）

```sh
# Mac 上：
docker pull --platform linux/amd64 nousresearch/hermes-agent:stable
docker save nousresearch/hermes-agent:stable | ssh ubuntu@119.27.191.90 'docker load'
```

（若服务器能直拉：`ssh ubuntu@… 'docker pull nousresearch/hermes-agent:stable'`，腾讯内网镜像源
mirror.ccs.tencentyun.com 未必缓存了它，失败就走上面的手动导入。）

## 2. 首次初始化（交互式向导，只做一次）

数据与密钥都落在宿主机 `~/bear-home-server/hermes-data/`（= 容器内 `/root/.hermes`），
config.yaml 与 SOUL.md 由仓库只读挂载进去。

```sh
ssh ubuntu@119.27.191.90
cd ~/bear-home-server
# 部署前先备份（铁律）：
bash scripts/backup.sh
# 拉最新代码后，进向导：
docker compose --profile hermes run -it --rm hermes
```

向导里：

1. 模型选 **OpenAI-compatible / 自定义端点**：base_url
   `https://open.bigmodel.cn/api/paas/v4`，模型 `glm-4-flash`（免费档，支持工具调用），
   Key 填智谱控制台创建的 Key（会写进 `hermes-data/.env` 的 `OPENAI_API_KEY`，不进 git）
2. 其他选项按需（terminal backend 保持 local 即可——它已在独立容器里，这就是隔离边界，
   **不要**再挂 docker.sock 进来做嵌套沙箱）

向导完成后验证两件事：

```sh
# 容器里起 hermes CLI，确认 MCP 通了、8 个工具可见
docker compose --profile hermes run -it --rm hermes hermes
# 会话内：/reload-mcp → 让它「查一下我家的装修记录」→ 应调用 list_entries 并返回
```

## 3. 常驻运行

```sh
docker compose --profile hermes up -d
docker compose --profile hermes logs -f hermes    # 观察启动
```

消息网关（不开 App 也能使唤小熊）：`docker exec -it <hermes容器> hermes gateway setup`，
Telegram 最省事；微信协议非官方、有封号风险，自用慎选。cron 周报在会话里用自然语言配
（「每周日 20:00 给我发进度周报」），SOUL.md 里已写好周报格式。

## 4. 端到端验证清单

- [ ] App 存一条小红书链接 → `list_links` 出现 `status=pending`
- [ ] Hermes 抓取写回 → status 变 `done`，title/summary 出现在笔记库
- [ ] 故意存一个打不开的 URL → status 变 `failed`，error 有原因
- [ ] cron 周报按点到达（网关配置后）
- [ ] 资源水位：`docker stats`（内存告警线 ~1.5G，超了就给 compose 加 mem_limit）

## 5. 升级与回滚

```sh
# 升级（先备份）：
bash scripts/backup.sh
docker pull --platform linux/amd64 nousresearch/hermes-agent:<新tag>   # Mac 上
docker save … | ssh … 'docker load'
# 改 docker-compose.yml 里的 tag → docker compose --profile hermes up -d
```

hermes-data/ 是它的记忆与技能目录（自学习产物都在里面），**备份脚本已覆盖 `data/`，
记得把 `hermes-data/` 也加进备份范围**（见 backup.sh 的 FILES 打包列表）。

## 6. 安全边界

- Hermes 能执行代码：它跑在独立容器，只经 `http://server:8787/mcp` + Bearer Token 访问数据，
  不共享 server 的文件系统写权限
- 智谱 Key 只存在于 `hermes-data/.env`；Token 泄露即全部数据权限，泄露就轮换
  （`.env` 改值后 `docker compose up -d`，前端 `.env` 同步）
- MCP 工具面在 `deploy/hermes/config.yaml` 可按需收紧（include 列表）
