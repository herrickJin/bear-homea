# 01 · 后端骨架 + 腾讯云部署

**状态**：✅ 完成（2026-10-10）

## 范围

`server/`（Hono + better-sqlite3 + MCP Server）从零搭建，并部署到腾讯云服务器，公网验证通过。

## 已交付

### 本地代码 `server/`
- `src/index.ts` 应用入口：CORS 白名单（localhost + 局域网来源）、Bearer 鉴权挂载
- `src/db/`：SQLite（WAL），三张表 `entries` / `links` / `files`，幂等迁移（statements 数组逐条 prepare+run）
- `src/routes/`：entries CRUD、links（status 即 Agent 任务队列：pending→processing→done/failed）、uploads（multipart 落盘 + `/files/:id` 读取）
- `src/services/files.ts`：`resolveWithin()` 路径边界校验 + UUID 白名单，防路径穿越
- `src/mcp/server.ts`：MCP Streamable HTTP（无状态模式），8 个工具：`list_entries` / `search_entries` / `get_entry` / `create_entry` / `list_links` / `get_link` / `save_link` / `update_link`
- `Dockerfile`（多阶段，npmmirror + 腾讯 debian 源 + 编译工具链兜底）、`docker-compose.yml`（server + caddy，预留 hermes 容器位）、`Caddyfile`、`deploy/bootstrap.sh`（新机一键部署）

### 服务器（腾讯云成都 119.27.191.90）
- 2C/2G(带2G swap)/50G，Ubuntu 24.04，用户 **ubuntu**（非 root），本机已配 SSH 免密 + sudo NOPASSWD
- 代码在 `~/bear-home-server/`，数据在 `~/bear-home-server/data/`（SQLite + 上传文件，备份即拷目录）
- Token 在 `~/bear-home-server/.env`（`BEAR_HOME_TOKEN`）
- 容器：caddy(~10MB) + server(~35MB)，80 端口纯 HTTP（无备案域名过渡方案）

## 验证记录（2026-10-10 公网实测）

health / 401 鉴权 / entries CRUD / 上传+读取 / 链接保存-去重-队列-写回-删除 / 路径穿越 404 / MCP initialize+tools/list(8)+tools/call / MCP 无 token 401 —— 全部通过。

## 踩坑记录（重要）

1. **Caddy `{$ENV:默认值}` 对空字符串不生效**：env 未设时 compose 仍传入空串，Caddy 拿到空站点地址报 `unrecognized global option` 进重启循环。已在 compose 用 `${BEAR_HOME_DOMAIN:-:80}` 兜底（`:-` 对空串也取默认）。
2. **容器内 Debian 官方源国内极慢**：首次构建卡 18 分钟。Dockerfile 里 `sed` 换 `mirrors.cloud.tencent.com`。
3. **服务器重置后本机 known_hosts 旧记录**导致 `Host key verification failed`：`ssh-keygen -R` 或带 `StrictHostKeyChecking=accept-new`。
4. **expect 装公钥**：公钥内容要 expect 自己读文件注入 ssh 命令，`cat | expect` 管道 stdin 传不进 spawn 的 ssh。
5. **Docker Hub / OpenAI 在这台服务器不可达**：镜像走 `mirror.ccs.tencentyun.com`；Agent 模型必须用国内可达端点（智谱实测 ~100ms）。

## 后续事项

- ⚠️ 登录密码曾出现在会话记录中，建议用户 `passwd` 轮换（SSH key 免密已可用，密码仅作备用）
- 有备案域名后：`.env` 加 `BEAR_HOME_DOMAIN=域名` → `docker compose up -d`，Caddy 自动 HTTPS（小程序正式版硬性要求）
- Token 如泄露可改 `.env` 后 `docker compose up -d` 轮换（前端配置在 `bear-home/.env` 的 `TARO_APP_API_TOKEN`，需同步；该文件不入 git）
- 数据备份：建议后续加 litestream 或 cron rsync `data/` 目录
