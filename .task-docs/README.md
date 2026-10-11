# 任务文档（.task-docs）

记录 bear-home 项目的任务拆分与进度。**每完成一个里程碑，更新对应任务文件和本索引。**

## 任务索引

| # | 任务 | 状态 | 文档 |
|---|------|------|------|
| 01 | 后端骨架（server/）+ 腾讯云部署 | ✅ 完成（2026-10-10） | [01-backend-server.md](./01-backend-server.md) |
| 02 | 前端（bear-home）接入后端 API | ✅ 完成（2026-10-10） | [02-frontend-api.md](./02-frontend-api.md) |
| 03 | 接入 Hermes Agent（MCP + 智谱 GLM） | 🚧 部署资产齐备（2026-10-12）· 待上服务器 | [03-hermes-agent.md](./03-hermes-agent.md) |
| 04 | 方案库（小红书收藏 · 剪贴簿） | 📋 方案定稿（2026-10-10）· 待开工 | [04-links-page.md](./04-links-page.md) |
| 05 | 前端功能剥离与骨架重置 | ✅ 完成（2026-10-10） | [05-skeleton-reset.md](./05-skeleton-reset.md) |
| 06 | 整体风格与设计 Token | ✅ 完成（2026-10-10） | [06-style-tokens.md](./06-style-tokens.md) |
| 07 | 记录页（选购台账） | 🚧 S1 页面完成（2026-10-12）· S2 服务端待立项 | [07-record-page.md](./07-record-page.md) |
| 08 | AI 助手（装修记录探讨） | 🚧 后端核心完成并验证（2026-10-12）· UI 待开工 | [08-ai-assistant.md](./08-ai-assistant.md) |

状态标记：✅ 完成 · 🚧 进行中 · 📋 待开始 / 规划中 · ⛔ 受阻

## 系统全景

```
bear-home (Taro 小程序/H5)  ──HTTP + Bearer Token──▶  server/ (Hono + SQLite)
                        │                                  ▲    │
                        │ 实时探讨 /api/chat（08）          │    │ MCP
                        └──────────────────────────────────┘    │ (Streamable HTTP)
                                                                │
                                            Hermes Agent (部署资产就绪，待上服务器)
                                                                │
                                                            智谱 GLM (API)
```

- 后端访问：`http://119.27.191.90`（Caddy 80 端口，Token 鉴权）
- 数据库：SQLite 单文件，在服务器 `~/bear-home-server/data/`，备份即拷目录
- MCP 端点：`http://119.27.191.90/mcp`（8 个工具，已公网验证）
- AI 通道：server `/api/chat`（App 内实时，已实现）+ Hermes 容器（异步常驻，待部署）

## 关键决策记录

- **自建轻量后端**而非微信云开发/Serverless：要跑异步任务和 Agent，且前后端统一 TypeScript（详见 01）
- **Agent 接开源 Hermes**而非裸调 LLM：用 MCP 标准接口对接，后端只暴露工具，不绑定任何 Agent 框架
- **数据源唯一化**：服务器是记录的唯一数据源，前端本地存储仅作离线缓存兜底
- **前端功能剥离（05）**：原前端功能多为 demo 写死数据，2026-10-10 全部移除只留跨端骨架；02 的前端接入层随之删除，待正式 PRD 后重建（后端与 02 的服务端部分仍然有效）
- **无备案域名过渡方案**：先走 `http://IP:80` 纯 HTTP + Token；有备案域名后改一行配置自动升级 HTTPS
