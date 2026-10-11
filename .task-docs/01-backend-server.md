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
- ~~数据备份：建议后续加 litestream 或 cron rsync `data/` 目录~~ → ✅ 已落地（2026-10-12，见下）

## 数据备份（2026-10-12 落地）

`server/scripts/backup.sh`（服务器上 `~/bear-home-server/scripts/backup.sh`）：

- **SQLite 快照走容器内 `better-sqlite3 .backup()`**（一致性在线快照，自动并含 WAL 数据）——
  本项目 WAL 常驻（曾出现主库 4KB / WAL 144KB），**直接 cp 主库文件会丢大部分数据**，禁止用 cp 备份
- 上传文件（`data/files/`，截图+封面转存）一并 tar 打包——库内 `shot_url`/`cover_url` 指向这些文件，须与库同份
- 产物落在 `~/bear-home-backups/`（data/ 之外，防误删连坐），滚动保留 14 份，快照经 `quick_check` 校验
- 定时：服务器 crontab 每日 03:02 自动执行，日志 `~/bear-home-backup.log`
- **升级/重建容器前必须手动先跑一次**：`~/bear-home-server/scripts/backup.sh`
- 恢复步骤见脚本头部注释（停 server → 换 .db 并删 wal/shm → 解包 files → chown root → 起容器）
- ⚠️ 尚无异地副本：单机单盘仍是最后风险，建议 Mac 每日 `scp -r` 拉取 `~/bear-home-backups/`，或配腾讯 COS

## 线上版本滞后提醒（2026-10-12 检查）

线上容器为 2026-10-10 12:22 构建（commit c951fc4 时期）：`/api/categories` 与 `/api/links/:id/notes`
均 404，库中无 `categories`/`link_notes` 表——**笔记库前端（分类管理/归类/备注时间线）在线上不可用**。
代码层（05d2fac）已完整适配前端；重新部署前先跑一次备份脚本，部署后迁移幂等自动补表、bind mount 数据不丢。
线上现存数据：entries 1 条、files 1 个、links 0 条。

## ✅ 已重新部署（2026-10-12 凌晨）

按上述流程执行完毕，线上已是最新代码（含 categories/notes/OG 抓取/备份脚本）：

1. 部署前备份 ✅（`~/bear-home-backups/bear-home-20261012-032807.db`）
2. `rsync`（排除 node_modules/dist/data/.env）→ `sudo docker compose up -d --build` ✅
3. 验证 ✅：health 200；`/api/categories` 404→200（8 个分类种子由迁移自动创建）；
   `/api/links` 200；公网（Mac 走 Clash）与服务器本机双端点实测一致
4. **前端配置同步**（`bear-home/.env`，不入 git）：`TARO_APP_API_BASE` 从局域网
   `192.168.1.43:8787` 切到公网 `http://119.27.191.90`；`TARO_APP_API_TOKEN` 从本地
   开发 token（`bh-local-…`）换成服务器 `.env` 的真实值。**dev server 需重启才生效**
   （Taro 构建时注入环境变量，watch 不会热读 .env）。
5. 数据澄清：dev 界面里的笔记此前一直是 mock 兜底（本机 server/data 仅 4KB、线上 links
   为空），无真实数据需迁移，笔记库自线上干净起步。
6. 调试备忘：公网自测时 `grep TARO_APP_API_TOKEN .env` 会同时命中注释行、token 混入
   换行 → 请求头非法 → Go 400（不进 Caddy 访问日志，极具迷惑性）；务必
   `grep '^TARO_APP_API_TOKEN='`。

## ✅ v0.3.0 前端上线（2026-10-12 凌晨）

线上地址 **http://119.27.191.90**（同一地址：/ 是网页，/api /files /mcp 是后端）。

- **git**：当前节点三连提交（笔记卡来源行+品牌标 / server 静态托管+备份脚本入库 /
  release 文档）后打 tag **v0.3.0**（a052026）
- **构建**：`bear-home` 的 `npm run build:h5` → `dist/h5`（1.2M，hash 路由、publicPath=/，
  API 地址与 token 构建时注入，已验证落在 chunk/143.js / chunk/740.js）
- **托管**：不装 nginx——服务器已有 Caddy，直接扩展：`./web` bind mount 进 caddy 容器
  （`/srv/web`），`/api/*`、`/files/*`、`/mcp*` 反代 server:8787，其余路径静态 + SPA 兜底；
  `/static/*` 文件名带 hash 长缓存一年 immutable，index.html 不缓存
- **流程**：rsync `dist/h5/` → `~/bear-home-server/web/`（--delete 保持一致）+ 同步
  Caddyfile/compose → `sudo docker compose up -d` 重建 caddy
- **验证**：index 200（标题正确）、app.js 200、api/health 与 api/categories 200；
  无头 Chrome 走公网实测：首页渲染 ✓、笔记页渲染出 8 个分类页签（数据来自线上 API）✓、
  空态「剪贴簿还空着」✓（不再走 mock）
- **后续发版**：改完前端 → build:h5 → `rsync -a --delete bear-home/dist/h5/ ubuntu@119.27.191.90:~/bear-home-server/web/` 即可；
  改后端 → rsync server/ + `sudo docker compose up -d --build`（先跑备份脚本）
- 注意：API token 打进了前端 JS 包（SPA 常态），泄露面=拿到包的人；自用可接受，
  如泄露按 01 章流程轮换 .env 并重建前端
