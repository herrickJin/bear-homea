# bear-home-server

熊熊之家的自托管后端：Hono + SQLite（better-sqlite3）+ MCP Server，单用户、单进程、单文件数据库，为 bear-home（Taro 小程序/H5）和后续接入的 Agent（Hermes 等）提供服务。

## 能力

| 模块 | 说明 |
|------|------|
| `/api/entries` | 装修记录 CRUD，字段与前端 `Entry` 一致（id/title/body/stage/date）。应用侧已不再使用（见 `.task-docs/08`），保留给 MCP |
| `/api/preparation` | 装修准备数据（准备项/候选/待归类/笔记关联）单行 JSON，`GET` 读、`PUT` 带 `revision` 乐观锁（冲突 409） |
| `/api/rooms` | 房间目录（固定 8 个房间 + 笔记分类名映射） |
| `/api/uploads` | 图片/文件上传（multipart），内容落盘 `DATA_DIR/files/`，元数据入库 |
| `/files/:id.ext` | 文件读取，免鉴权（UUID 不可枚举即凭证），长缓存 |
| `/api/links` | 第三方链接（小红书等）收藏；`status` 字段即处理队列：`pending → processing → done/failed` |
| `/api/chat` | AI 助手（装修记录探讨）：OpenAI 兼容端点（默认智谱）+ 内部工具循环 + 会话持久化；配 `AI_API_KEY` 即启用，未配返回 503 |
| `/api/record-draft` | 随手记 → 选购草稿（单次，不落库，用户确认后由前端保存） |
| `/api/analyze` | 候选 → 选购分析文本（单次，不落库；分析来源链接归用户维护，模型不生成） |
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

## AI 助手（/api/chat）

`.env` 配 `AI_API_KEY`（智谱等 OpenAI 兼容端点的 Key）即启用。本地没有 Key 时用假 LLM 联调：

```sh
node scripts/mock-llm.mjs 9393            # 假 LLM（含工具调用剧本）
AI_API_KEY=mock AI_API_BASE=http://localhost:9393/v1 npm run dev
curl -N -X POST localhost:8787/api/chat/stream -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"帮我把这个记下来：橱柜铰链选百隆","context":{"page":"record"}}'
```

工具面与应用侧可见的数据一致：**装修准备**（`preparation_state`）+ **笔记库**（`links`）。

- 读：`list_room_preparation` / `list_candidates` / `search_candidates` / `get_candidate` / `list_links` / `search_links` / `get_link`
- 写：`add_candidate`（屋主说「帮我记下来」时落成候选；房间必填，准备项按品类自动归类，归不上进「待归类」）、`save_candidate_analysis`（把分析写进已有候选，只替换正文，不动用户维护的来源链接）

AI 写过的数据会递增 `preparation_state.revision`，所以聊天响应带 `changed` 字段
（同步响应顶层，SSE 在 `done` 事件里）：非空表示前端该重新拉一次准备数据，
否则本地 revision 已过期，下次保存会撞 409。

工程约定：AI 内部工具只读取应用侧真正在用的数据。旧的 `entries` 表应用侧不写入也不
展示，因此**不在聊天工具面里**（保留在 MCP 供 Hermes 使用），否则模型会拿一张空表
当「他家的现状」。快照（`buildSnapshot`）同样只读准备数据与笔记。

接口契约、工具面与 UI 接入点见 `.task-docs/08-ai-assistant.md`。

## AI 单次动作（/api/record-draft · /api/analyze）

与聊天分开的另一条形态：**单次、非流式、只出文本、不落库**，由用户在前端确认后保存。
两处都复用 `.env` 里的 `AI_API_KEY` / `AI_API_BASE` / `AI_CHAT_MODEL`，未配 Key 返回 503。

```sh
# 随手记 → 选购草稿
curl -X POST localhost:8787/api/record-draft -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"text":"客厅沙发 7299，宽 2.6 米","room":"客厅"}'
# 候选 → 选购分析
curl -X POST localhost:8787/api/analyze -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"room":"全屋","name":"海信 5G+荣耀家 · 5匹","itemName":"中央空调","price":null}'
```

`/api/analyze` 的输出是 `{analysis}`，正文用空行分段、**第一段是结论摘要**（前端列表只
展示第一段），最多 4000 字。模型没有联网能力，因此契约里**没有来源字段**：来源链接归
用户维护（`candidate.analysisSources` 原样保留），分析里没核实的信息必须写「待核实」，
不允许编造型号、参数或来源链接。

`GET` 两个接口都返回 `{available}`，表示 Key 是否配置，不保证提供方可用。

本地没有 Key 时用假 LLM 联调（见上），它按 system 提示词区分这两个单次动作和聊天工具剧本。

## MCP（给 Hermes / 其他 Agent 接入）

Streamable HTTP 端点 `http://<host>:8787/mcp`，请求头带 `Authorization: Bearer <token>`。
工具清单：`list_entries` / `search_entries` / `get_entry` / `create_entry` /
`list_links` / `get_link` / `save_link` / `update_link`。

Hermes 容器部署（compose `profiles: ["hermes"]`，默认不启动）与配置见
[deploy/hermes/README.md](./deploy/hermes/README.md)；MCP 配置写法：

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  bear-home:
    url: "http://server:8787/mcp"
    headers:
      Authorization: "Bearer ${BEAR_HOME_TOKEN}"
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

## 一句话选购记录

`POST /api/record-draft`（需 Bearer Token）接收 `{text, room?}`，返回 `{draft}`，包含名称、价格、单位、房间、软硬装、品类、备注、优点和顾虑。只有用户确认后才由前端保存；此接口不写数据库，也不执行聊天工具。价格不明为 null，模型返回内容经过字段与范围校验。最多 2000 字，模型请求超时 45 秒。

复用 `.env` 的 `AI_API_KEY`、`AI_API_BASE`、`AI_CHAT_MODEL`；没有密钥返回 503。`GET /api/record-draft` 返回 `{available}`，表示密钥是否配置，不保证提供方可用。

H5 本地开发由 5173 的 `/record-ai` 代理到 8787，代理读取本目录 `.env` 的 `BEAR_HOME_TOKEN`，不改变现有笔记接口地址。本项目原生 SQLite 依赖需要与 Node 版本一致；当前安装可用 Node 23.8.0。正式部署还需发布后端新接口。

回归测试：`node --import tsx --test tests/record-draft.test.ts`（使用模拟模型响应，不调用外部服务）。
