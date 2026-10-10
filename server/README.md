# bear-home-server

熊熊之家的自托管后端：Hono + SQLite（better-sqlite3）+ MCP Server，单用户、单进程、单文件数据库，为 bear-home（Taro 小程序/H5）和后续接入的 Agent（Hermes 等）提供服务。

## 能力

| 模块 | 说明 |
|------|------|
| `/api/entries` | 装修记录 CRUD，字段与前端 `Entry` 一致（id/title/body/stage/date） |
| `/api/uploads` | 图片/文件上传（multipart），内容落盘 `DATA_DIR/files/`，元数据入库 |
| `/files/:id.ext` | 文件读取，免鉴权（UUID 不可枚举即凭证），长缓存 |
| `/api/links` | 第三方链接（小红书等）收藏；`status` 字段即处理队列：`pending → processing → done/failed` |
| `/mcp` | MCP Server（Streamable HTTP，无状态模式），把上述能力暴露为工具给 Agent |

鉴权：除 `/api/health`、`/`、`/files/*` 外全部要求 `Authorization: Bearer <BEAR_HOME_TOKEN>`。

## 本地开发

```sh
cp .env.example .env          # 修改 BEAR_HOME_TOKEN
npm install
npm run dev                    # http://localhost:8787
```

## 快速验证

```sh
TOKEN=你的token
curl -s localhost:8787/api/health
curl -s -X POST localhost:8787/api/entries -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"水电交底","body":"多留插座","stage":"水电"}'
curl -s -X POST localhost:8787/api/uploads -H "Authorization: Bearer $TOKEN" -F file=@photo.jpg
curl -s -X POST localhost:8787/api/links -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"url":"https://www.xiaohongshu.com/explore/xxx"}'
```

## MCP（给 Hermes / 其他 Agent 接入）

Streamable HTTP 端点 `http://<host>:8787/mcp`，请求头带 `Authorization: Bearer <token>`。
工具清单：`list_entries` / `search_entries` / `get_entry` / `create_entry` /
`list_links` / `get_link` / `save_link` / `update_link`。

Hermes 侧配置示例（MCP server 类型，remote HTTP）：

```json
{
  "mcpServers": {
    "bear-home": {
      "url": "http://server:8787/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

链接处理约定（Agent 的标准流程）：

1. `list_links` 取 `status=pending` 的任务
2. 先 `update_link(id, status="processing")`
3. 用自己的网页抓取能力读取 `url`，总结出 `title` / `summary` / `cover_url`（可选 `content` 全文）
4. `update_link(id, {title, summary, cover_url, content, status="done"})`；失败则 `status="failed"` 并写 `error`

## 部署（腾讯云 Ubuntu 24.04）

```sh
# 本机：上传代码
rsync -av --exclude node_modules --exclude dist --exclude data --exclude .env \
  ./ ubuntu@<服务器IP>:~/bear-home-server/

# 服务器上：一键初始化（装 Docker + 配加速 + 生成 Token + 构建启动）
ssh ubuntu@<服务器IP> "bash ~/bear-home-server/deploy/bootstrap.sh"
```

- 无备案域名时默认走 `http://<IP>:80`（纯 HTTP，靠 Token 保护）；注意腾讯云控制台防火墙需放行 80 端口
- 以后有备案域名：`.env` 里加 `BEAR_HOME_DOMAIN=域名` 再 `sudo docker compose up -d`，Caddy 自动签 HTTPS
- 数据全在 `./data/`（SQLite 库 + 上传文件），备份就是备份这个目录；建议配合 litestream 或定时 rsync
- Hermes 后续以独立容器加入 `docker-compose.yml`（文件里已留注释模板），与 server 同网络，走内网 `http://server:8787/mcp`

## 安全注意

- Agent（能执行代码）务必运行在独立容器里，不要与 server 共享文件系统写权限
- `BEAR_HOME_TOKEN` 用强随机值（如 `openssl rand -hex 32`），泄露即全部权限泄露
- 小程序正式版要求接口域名 HTTPS + ICP 备案；自用可主要走 H5 或小程序开发/体验版

## 目录

- `src/config.ts` 环境变量与 .env 加载
- `src/db/` SQLite 连接与幂等迁移（`schema.ts` 内 `statements` 数组）
- `src/routes/` entries / links / uploads(+files) 路由
- `src/services/files.ts` 磁盘存储（`resolveWithin` 保证路径不越界）
- `src/middleware/auth.ts` Bearer Token 鉴权
- `src/mcp/server.ts` MCP 工具注册与 Streamable HTTP 端点
