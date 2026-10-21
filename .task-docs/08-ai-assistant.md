# 08 · AI 助手（装修记录探讨）：后端核心 + Hermes 接入 + UI 接入点

**状态**：✅ 后端核心上线服务器（2026-10-12）+ Hermes 容器已上线验证 · UI 待开工

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
| `services/preparation-state.ts` | 装修准备数据的唯一读写口（HTTP 路由与 AI 工具共用；`writePreparationState` 走乐观锁，`mutatePreparationState` 供 AI 原子读改写） |
| `services/ai/tools.ts` | 8 个内部工具（同进程直读 SQLite，参数化查询+与 MCP 同样的裁剪）：7 读 + `add_candidate` 写 |
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

### 工具面（2026-10-15 起：与应用侧真实数据对齐）

原则：**AI 只读应用侧真正在用的数据**。装修准备（`preparation_state`）+ 笔记库（`links`）；
旧的 `entries`（装修记录）表应用侧从不写入也不展示，已移出聊天工具面（保留在 MCP 给
Hermes），否则模型会拿一张空表当「他家的现状」，答「还没有记录」而其实有候选。

- 读：`list_room_preparation` / `list_candidates` / `search_candidates` / `get_candidate`
  / `list_links` / `search_links` / `get_link`
- 写：`add_candidate` —— room 必填（不在房间列表直接拒绝，不猜）；price 只填用户明确说过的
  数字（负数/非数字一律落 null）；准备项按品类别名→名称包含自动归类，**自动归类会避开
  用户标了「暂不需要」的准备项**（留待归类由用户认领），明确点名 `itemName` 时才无视该标记；
  归不上就进「待归类」。旧的 `create_entry` 已由它取代。可选带 `analysis`。
- 写：`save_candidate_analysis`（2026-10-15）——把分析正文写进已有候选，**只替换
  `analysis`，保留用户维护的 `analysisSources`**（模型没有联网能力，来源不由它生成，
  也不该被它清掉）。
- 快照 `buildSnapshot()`：概要（准备项/候选/待归类计数、按房间、已选定）+ 前 12 条候选 + 笔记库，
  不再读 `entries`。
- 链接写回（update_link）仍**不在聊天工具面**——队列语义归 Hermes，避免 UI 探讨误改状态。

### 单次动作（/api/analyze）

聊天之外的第二条形态（与 `/api/record-draft` 同构）：**单次、非流式、只出文本、不落库**，
用户确认后由前端写进 `candidate.analysis` 再走 `preparation_state` 同步。存在的理由：
「分析这款」是场景内的一次性动作，不需要会话、不需要流式，也不该让模型直接改数据。

- 输入：候选的房间/名称/准备项/品类/软硬装/价格/单位/备注/优缺点/参数/链接（+ 可选 focus）
- 输出：`{analysis}`，空行分段，**第一段是结论摘要**（列表只显示第一段），≤4000 字
- 契约里**没有来源字段**：`analysisSources` 由用户维护，分析里未核实的信息必须写「待核实」，
  禁止编造型号/参数/来源链接；不替用户下「值不值得买」的结论
- 这替代了此前把海信中央空调的分析写死在 `centralAcImport.ts` 的做法——那段常量作为
  一次性数据导入保留（内容真实、幂等、不重复添加），但它不再是「选购分析」的唯一来源

### 写操作对前端的信号（`changed`）

AI 写候选会递增 `preparation_state.revision`。前端手里的 revision 随即过期，下次 PUT 会撞
409——所以聊天响应回传 `changed`：同步响应顶层 `changed`，SSE 在 `done` 事件里。
非空（当前只有 `["preparation"]`）表示前端应重新拉取准备数据再继续编辑。

### API 契约

```
POST /api/chat                      # 同步（小程序用，Taro.request 无流式）
  {"message":"水电阶段要注意什么","sessionId?":"chat-…","context?":{"page":"record","ref":{…}}}
  → 200 {"sessionId":"…","reply":"…","changed":[]}   503 未配 AI_API_KEY   502 模型端点错误

POST /api/chat/stream               # SSE（H5 用），同样请求体
  ← event: tool  {"name":"search_candidates"}  # 模型查库（可多次）
  ← event: delta {"text":"…"}                  # 文本增量
  ← event: done  {"sessionId":"…","reply":"…","changed":[]}  # 全文 + 写入信号
  ← event: error {"message":"…"}

GET    /api/chat/sessions           # 会话列表（含 message_count、last_reply 摘要）
GET    /api/chat/sessions/:id       # 会话 + 全部消息（含工具往返，UI 可只渲 user/assistant）
DELETE /api/chat/sessions/:id
```

系统提示词要点：小熊人设（第一次装修的小两口、说人话、给理由）、今天日期、
**项目快照**（准备项/候选/待归类计数 + 按房间 + 已选定 + 前 12 条候选；笔记数按状态统计 +
最近 8 条摘要）、报价只是用户记的数字而非市场价、归不上准备项就进待归类别硬塞、
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

### ✅ 已实现 · 记录页 · 候选详情「让小熊分析这款」（2026-10-15）

不是聊天，是场景内的**单次动作**（与「AI 整理」同构），入口在候选详情弹层
（`Preparation.tsx` 的 `prep-detail-actions`）：点一下 → 调 `/api/analyze` → 面板内出现
**虚线框的「分析预览（还没保存）」** → 「保存到这条候选」才写进 `candidate.analysis`
并随 `preparation_state` 同步（失败只显示错误文案，不写任何东西）。已有分析时按钮变
「重新分析」，保存只替换正文、保留用户维护的来源链接。

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

## 五、验证记录

### 本地（2026-10-15，AI 数据面接到应用侧真实数据）

- `server/tests/ai-preparation-tools.test.ts` 12 例：读工具按房间/准备项/状态/关键词过滤、
  候选详情带关联笔记、`add_candidate` 自动归类与显式点名、「暂不需要」不自动归类、
  未知房间拒绝且不动数据、负数价格与非法链接落 null、快照不再包含 `entries` ✅
- 回归：`tests/preparation.test.ts`（乐观锁/校验/恢复）+ `tests/record-draft.test.ts` 全绿，
  `tsc --noEmit` 通过 ✅
- mock-llm 端到端（临时 DATA_DIR，已清理）：同步「帮我记一下」→ `changed:["preparation"]`，
  候选真实写入并自动归入准备项「沙发」，revision 1→2；随后用旧 revision PUT 得 409
  （正是 `changed` 要提前规避的场景）✅
- SSE：只读调用 `done.changed=[]`；`add_candidate` 的 `done.changed=["preparation"]` ✅
- `list_room_preparation` 经聊天循环真实命中 ✅
- 坑：清单按准备项筛选时，**待归类候选（无 itemId）曾绕过过滤**计入结果——由新测试抓出并修掉
- 本次只改服务端，**App 侧 UI 仍未开工**；未部署到生产

#### 选购分析（同日补做，服务端 + App 侧）

- `tests/candidate-analysis.test.ts` 4 例：围栏 JSON 与长度校验、必填与价格校验、未配 Key 503、
  模型输出非法/网络异常/超时 → 502/502/504、请求**不带 tools**、system 约束「不得声称查过网页」
- `tests/ai-preparation-tools.test.ts` 扩到 14 例（全仓 21 例全绿）：`add_candidate` 可带 analysis
  且列表视图不回传长文本、`save_candidate_analysis` 替换正文**保留 `analysisSources`**、
  not_found/空文本失败时不动 revision
- mock-llm 端到端：`GET /api/analyze` → `available:true`；`POST` 返回合法三段式分析；
  **分析前后 `preparation_state.revision` 不变**（确认不落库）✅
- 校验/鉴权：缺 name → 400，无 Token → 401 ✅
- mock 增加按 system 提示词区分单次动作的分支，`/api/record-draft` 回归仍返回草稿 ✅
- App：`tsc --noEmit`、`build:h5`、`build:weapp` 全部通过 ✅
- 传输层收口：`TARO_APP_AI_BASE` 统一（旧名 `TARO_APP_RECORD_AI_BASE` 仍兼容），
  `recordDraft.ts` 与 `analyze.ts` 共用一个 base
- 仍未部署到生产

### 本地（2026-10-12，mock-llm 端到端）

- 非流式：查 → search_entries 工具循环 → 回复 ✅
- SSE：记 → tool 事件（create_entry）→ delta×3 → done（sessionId 正确）✅
- 落库：chat_sessions/chat_messages 结构正确（user → assistant+tool_calls → tool → assistant）✅
- AI 工具 create_entry 真实写入 entries ✅（测试数据在临时 DATA_DIR，未污染）
- 多轮同会话 ✅（mock 实证 turn2 收到完整 6 条消息：system+4 历史+新 user）
- 无 Key 503 ✅ / 无 Token 401 ✅ / MCP 回归 8 工具 ✅ / `tsc` 构建 ✅
- Mimosa 安全钩子：无新增告警（参数化查询、凭据只走 env）
- code-reviewer 复查：修复 1 个关键 bug（历史截断曾致多轮失忆）+ 4 个次要项
  （流式异常补日志、取消静默、toolRounds 兜底、系统提示词本地时区）
- ⚠️ 上表工具名已于 2026-10-15 变更（entries 系 → preparation 系），旧记录仅作历史

### 服务器（2026-10-15 数据面 + 选购分析上线实测）

- 部署方式：本地 `ssh tencent` 直连（`~/bear-home-server`），**不走** Hermes 容器内的
  `scripts/deploy.sh`（那是 coder 容器专用通道）。流程：`sh scripts/backup.sh` →
  `docker tag ... before-analyze-20261015`（回滚镜像）→ rsync `src/` → `docker compose up -d
  --build --no-deps server`
- 同步范围先做逐文件 SHA-256 比对：**3 新 + 5 改**，其余 19 个文件一致；部署后再比对，
  22 个文件全部一致 ✅
- 备份：`bear-home-20261015-013713.db`（quick_check 通过）+ `files-*.tar.gz`（2.2M）+
  `hermes-*.tar.gz`（61M，打包期间 agent 在跑，脚本自检通过并给告警——既有现象）
- 验证：health 200；`/api/analyze` 从 404 → `available:true`；`/api/record-draft` 仍
  `available:true`；`/api/preparation` revision 8、37 个准备项原样；`/api/chat/sessions`
  正常；无 Token 401 ✅
- **真模型实测**（glm-5.3，线上同一个 Key）：`POST /api/analyze` → 200，6 段、首段是结论、
  752 字、无来源字段 ✅ **但耗时 37.7s**——原 45s 服务端上限余量太薄，已提到 **90s**
  （客户端 50s → 95s），并重新部署
- **App 端到端**（本地 H5 5173 → 生产后端）：44.0s 返回，候选详情「让小熊分析这款」→
  分析预览 → 保存 → `preparation_state` revision 10 落库（6 段分析）→ 移除临时候选后
  revision 11、候选数回到 0、准备项 37 不变 ✅（测试数据已清理）
- 坑：用户已有一个 dev watcher 占用 5173，它是**改 config 之前**启动的，缺
  `TARO_APP_AI_BASE` 常量替换 → 点「清单」抛 `ReferenceError: process is not defined`
  （config/index.ts 注释里记的同一个坑）。**改 config/index.ts 必须重启 dev server**，
  热更新不重载 webpack 配置。

#### Web 静态产物同步（同日，`http://119.27.191.90`）

- 之前线上 `web/` 还是 2026-10-14 的旧产物，所以功能只在本机 dev 可见
- 与 hook 同样的语义（`deploy-hook.sh` web 分支）：本地 `npm run build:h5`（读
  `bear-home/.env` → 指向生产）→ `rsync -a --delete dist/h5/ → ~/bear-home-server/web/`
  → `chmod -R o+rX web`
- 备份：`web-before-analyze-20261015.tar.gz`（788K，回滚即解包到 `web/`）
- 产物自检：21 个文件；`119.27.191.90` 出现 7 处、`127.0.0.1:8787` **0 处**（确认没有把
  本地联调地址打进生产包）；含「让小熊分析这款」
- 公网验证：`/` 200、`/chunk/475.js` 200 且含新功能文案与生产 API 地址；
  浏览器打开 `http://119.27.191.90` → 清单页正常渲染、无 JS 报错、数据从生产同步 ✅

### 服务器（2026-10-12 上线实测）

- 部署：backup.sh → rsync → `docker compose up -d --build`；坑：**compose 必须给 server 服务
  加 `env_file: .env`**（config.ts 只读进程环境，容器里没有 .env 文件，光 environment 列
  BEAR_HOME_TOKEN 时 AI_* 进不去）
- `/api/chat` 真模型（glm-5.3 · 智谱 coding 端点，与 Mac 本地 Hermes 同一 Key）：工具查询 +
  人设回复 ✅
- `/api/chat/stream` 公网（Caddy 反代）SSE 逐 token 到达，无缓冲问题 ✅
- Hermes 容器上线：镜像服务器直拉成功；bootstrap.sh 注入模型/MCP/SOUL；链接队列
  pending→抓取→写回→done 全链路 ✅（详见 03 与 deploy/hermes/README.md）
- 测试数据已清理（links 0 / chat_sessions 0）

## 六、已知边界与后续

- glm-4-flash 免费档工具调用一般；线上已用 `glm-5.3`（智谱 coding 端点，`.env` 配置）
- context.ref 由前端注入（单用户自用，无伪造风险；多用户化时需服务端校验）
- 同会话并发消息未加锁（单用户可接受）
- **AI 写候选会让前端 revision 过期**：靠 `changed` 让前端主动刷新；若用户此时手里还有
  未同步的本地草稿，UI 需要先提示再刷新（冲突策略归 App 侧实现）
- 工具面已闭环，但 `entries` 表仍是「只写不读」的历史遗留——是否把「装修记录/日志」
  做成应用侧可见的功能，是独立的产品决策
- App 侧仍未开工，落地顺序：**传输层收口（统一 AI base + 双端流式 + health）→
  P0 两处原地探讨入口 → P1 会话页 → P2**
- ~~上服务器~~ ✅ 2026-10-12 已上线（server + Hermes 容器），见第五节；2026-10-15 的
  数据面改动**尚未部署生产**（`server/src/services/preparation-state.ts` 等）
