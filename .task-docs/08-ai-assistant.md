# 08 · AI 助手（装修记录探讨）：后端核心 + Hermes 接入 + UI 接入点

**状态**：🚧 后端核心完成并验证（2026-10-12）· UI 待开工 · Hermes 容器待上服务器

## 目标

让 AI 辅助装修记录探讨：App 内随时「问小熊」（基于他家的真实记录），Hermes 在后台
干常驻的活（链接抓取、定时汇总、消息网关）。本篇定稿三件事：**双通道架构**、
**server 端 AI 核心（已落地）**、**UI 接入点（待实现）**。

## 一、架构：双通道，一个数据核心

```
┌──────────── bear-home（Taro 前端）────────────┐
│ UI AI 接入点：页内原地探讨（问小熊）            │
└─────────────┬────────────────────────────────┘
              │ HTTP + Bearer Token（与现有 API 同通道）
┌─────────────▼──── server（Hono，容器）─────────┐
│ /api/chat        AI 助手：系统提示词(项目快照+  │
│   /chat/stream     页面上下文) + 工具循环 +    │
│   /chat/sessions   会话持久化 ← UI 全部接这里   │
│ /mcp             MCP Server（8 工具）           │
└─────────────┬─────────────────────────────────┘
              │ 容器内网 http://server:8787/mcp + Token
┌─────────────▼──── hermes 容器（独立隔离）───────┐
│ 常驻异步智能：links 队列消费（抓取→总结→写回）、  │
│ cron 周报、消息网关（微信/Telegram）             │
└─────────────────────────────────────────────────┘
        两边共用同一 SQLite，模型都走智谱（国内可达）
```

**为什么分两条通道**：App 内探讨要「页面上下文注入 + 亚秒首响 + 会话可回看」，
塞给 Hermes 会多一跳且它的会话模型对不上 UI 状态；而队列消费/cron/网关是
「没人盯着也要干的活」，正是 Hermes 的形态。两者不绑定：换掉 Hermes 不影响
`/api/chat`，server 挂了 Hermes 也只是没活干。

## 二、server 端 AI 核心（已实现，2026-10-12）

新增文件（`server/src/`）：

| 文件 | 职责 |
|------|------|
| `services/ai/provider.ts` | OpenAI 兼容流式客户端（fetch 手写 SSE 解析，零新依赖；智谱等端点通用） |
| `services/ai/tools.ts` | 7 个内部工具（同进程直读 SQLite，参数化查询+与 MCP 同样的裁剪） |
| `services/ai/agent.ts` | 系统提示词（项目快照+上下文）、工具循环（≤6 轮）、会话持久化 |
| `routes/chat.ts` | REST/SSE 路由 + 会话管理 |
| `scripts/mock-llm.mjs` | 假 LLM（OpenAI 兼容），无 Key 也能联调全链路 |

配置（`.env`，全部可选，不配则聊天 503、其余功能不受影响）：

```
AI_API_KEY      # 智谱 Key（OpenAI 兼容端点通用）
AI_API_BASE     # 默认 https://open.bigmodel.cn/api/paas/v4
AI_CHAT_MODEL   # 默认 glm-4-flash（免费档，支持工具调用）
AI_MAX_TOOL_ROUNDS  # 默认 6
```

迁移新增两张表：`chat_sessions`（title 首条消息截 24 字、context 存前端注入 JSON）、
`chat_messages`（role: user/assistant/tool，tool_calls 与 tool_call_id 按 OpenAI 协议存）。

### 工具面（v1：读为主 + create_entry）

`list_entries` / `search_entries` / `get_entry` / `create_entry` /
`list_links` / `search_links`（新增：搜标题/摘要/正文）/ `get_link`。
链接写回（update_link）**不在聊天工具面**——队列语义归 Hermes，避免 UI 探讨误改状态。

### API 契约

```
POST /api/chat                      # 同步（小程序用，Taro.request 无流式）
  {"message":"水电阶段要注意什么","sessionId?":"chat-…","context?":{"page":"record","ref":{…}}}
  → 200 {"sessionId":"…","reply":"…"}   503 未配 AI_API_KEY   502 模型端点错误

POST /api/chat/stream               # SSE（H5 用），同样请求体
  ← event: tool  {"name":"search_entries"}     # 模型查库（可多次）
  ← event: delta {"text":"…"}                  # 文本增量
  ← event: done  {"sessionId":"…","reply":"…"} # 全文（客户端可只用增量）
  ← event: error {"message":"…"}

GET    /api/chat/sessions           # 会话列表（含 message_count、last_reply 摘要）
GET    /api/chat/sessions/:id       # 会话 + 全部消息（含工具往返，UI 可只渲 user/assistant）
DELETE /api/chat/sessions/:id
```

系统提示词要点：小熊人设（第一次装修的小两口、说人话、给理由）、今天日期、
**项目快照**（记录数按阶段统计 + 最近 8 条；笔记数按状态统计 + 最近 8 条摘要）、
前端注入的 `context`（当前页 + 选中条目，截 4000 字）。

## 三、Hermes 接入（部署资产已备，待上服务器）

- `docker-compose.yml`：`hermes` 服务（`nousresearch/hermes-agent:stable`，
  **profiles: ["hermes"]**——默认 `docker compose up -d` 完全不受影响）
- `deploy/hermes/config.yaml`：MCP 指内网 `http://server:8787/mcp` + `${BEAR_HOME_TOKEN}`，
  8 工具全开可收紧；模型端点智谱
- `deploy/hermes/SOUL.md`：小熊人设 + 链接处理 SOP + 周报职责
- `deploy/hermes/README.md`：完整手册（Mac 导镜像→向导初始化→常驻→验证清单→升级回滚）
- `scripts/backup.sh`：hermes-data/（记忆与技能）条件打包
- 镜像 104 个 tag，`stable` / 版本号 tag 均有（amd64+arm64）；国内从 Mac `docker save | ssh docker load`

## 四、UI 接入点（待实现，按优先级）

原则：**原地探讨，不跳页**（对齐 3.2 详情弹层模式）；气泡与输入条复用既有 token；
内容区中性（气泡不进暖色），小熊只出现在会话空态与头像位。

### P0 · 记录页 · 台账条目「问问小熊」（LedgerDetailSheet 底部）
- 形态：详情弹层内 hairline 之下加一条入口（`问问小熊：这个价能入吗` 弱引导文案），
  点击原地展开对话区（弹层内下半屏，不关弹层）
- 注入 context：`{page:"record", ref: item}`（名称/品类/渠道/价格/状态/备注）
- 预置追问 chip：`这个价能入吗` / `同价位还有什么` / `什么时候买便宜` / `帮我记个结论`
- 台账目前在本地存储（07-S2 上 server 后，AI 就能直接查台账；v1 先靠 ref 注入）

### P0 · 笔记库 · 笔记详情「和小熊聊聊这篇」（LinkDetailSheet）
- 形态：右栏备注区上方加入口；或备注输入条左侧加小熊小图标（30px，点击切换 AI 模式）
- 注入 context：`{page:"inspiration", ref:{title, summary, source}}`
- 典型问题：`这篇的要点帮我记进装修记录`（→ create_entry）/ `适合我家吗` / `和已收藏的同类笔记比`

### P1 · 全局 · AI 会话页（pages/assistant）
- 入口：侧栏品牌区下方「小熊」项（桌面）/ 底导上方悬浮或 profile 页（手机，位置待定稿）
- 功能：新对话、历史会话列表（`GET /api/chat/sessions`）、删会话
- 视觉：白墙底，气泡——用户=井底右对齐、小熊=白底 hairline 左对齐；
  输入条复用备注输入条形态（r-lg 容器 + 透明 textarea + 陶橘圆发送钮 32px）
- 流式：H5 走 SSE 逐字；小程序走同步接口 + loading；「翻了翻装修记录…」对应 tool 事件

### P2 · 首页「今天该干嘛」（home 现为占位）
- AI 生成每日一条建议（基于阶段进度+最近记录），作为首页首卡；数据上 server 后自然成立

### P2 · 预算页 AI 问答（budget 现为占位）
- 等 07-S2 台账上 server：`这个月花超了吗` / `家电预算还剩多少` 由 AI 算账

### 非 UI · Hermes 侧触达（部署后即得）
- 收藏链接自动总结写回笔记库；周日 20:00 周报；网关直接问「这周该干嘛」

## 五、验证记录（2026-10-12，mock-llm 端到端）

- 非流式：查 → search_entries 工具循环 → 回复 ✅
- SSE：记 → tool 事件（create_entry）→ delta×3 → done（sessionId 正确）✅
- 落库：chat_sessions/chat_messages 结构正确（user → assistant+tool_calls → tool → assistant）✅
- AI 工具 create_entry 真实写入 entries ✅（测试数据在临时 DATA_DIR，未污染）
- 多轮同会话 ✅（mock 实证 turn2 收到完整 6 条消息：system+4 历史+新 user）
- 无 Key 503 ✅ / 无 Token 401 ✅ / MCP 回归 8 工具 ✅ / `tsc` 构建 ✅
- Mimosa 安全钩子：无新增告警（参数化查询、凭据只走 env）
- code-reviewer 复查：修复 1 个关键 bug（历史截断曾致多轮失忆）+ 4 个次要项
  （流式异常补日志、取消静默、toolRounds 兜底、系统提示词本地时区）

## 六、已知边界与后续

- glm-4-flash 免费档工具调用一般；复杂任务 `.env` 换 `glm-4.6` 即可，代码零改动
- context.ref 由前端注入（单用户自用，无伪造风险；多用户化时需服务端校验）
- 同会话并发消息未加锁（单用户可接受）
- UI 实现顺序建议：P0 两处（小改动大价值）→ P1 会话页 → P2
- 上服务器：先 `bash scripts/backup.sh`，rsync 后 `docker compose up -d --build`；
  Hermes 按 `deploy/hermes/README.md` 单独走
