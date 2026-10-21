# AI 选购草稿后端部署（2026-10-14）

- 服务器：119.27.191.90，ubuntu，生产目录 `~/bear-home-server`。
- 发布文件：`src/index.ts`、`src/routes/record-draft.ts`、`src/services/ai/record-draft.ts`。
- 复用现有服务器 AI 配置（glm-5.3），未复制或更改模型密钥。
- 部署：`docker compose up -d --build --no-deps server`，仅重建后端。
- 数据备份：`~/bear-home-backups/bear-home-20261014-205509.db`（quick_check 通过）和同时间戳 files 包；Hermes 数据包自检通过，打包期间运行中目录有变动告警。
- 更新前代码：`~/bear-home-backups/server-source-before-ai-draft-20261014.tar.gz`。
- 回退镜像：`bear-home-server-server:before-ai-draft-20261014`。
- 校验：健康接口 200；草稿接口无令牌 401；有令牌 GET 返回 available=true；真实模型 POST 返回合法草稿（约 7 秒），未写入业务数据库。生产三个源码文件 SHA-256 与本地一致。
- 本地 H5 `.env` 的 `TARO_APP_RECORD_AI_BASE` 已指向服务器，并重启开发服务；其他 API 配置保持原值。服务器上的网页静态产物未随本次后端部署更新。
- 清单数据仍是前端内存示例；后端部署不包含清单持久化。
