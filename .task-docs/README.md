# 任务文档（.task-docs）

记录 bear-home 项目的任务拆分与进度。**每完成一个里程碑，更新对应任务文件和本索引。**

## 任务索引

| # | 任务 | 状态 | 文档 |
|---|------|------|------|
| 01 | 后端骨架（server/）+ 腾讯云部署 | ✅ 完成（2026-10-10） | [01-backend-server.md](./01-backend-server.md) |
| 02 | 前端（bear-home）接入后端 API | ✅ 完成（2026-10-10） | [02-frontend-api.md](./02-frontend-api.md) |
| 03 | 接入 Hermes Agent（MCP + 智谱 GLM） | 📋 待开始 | [03-hermes-agent.md](./03-hermes-agent.md) |
| 04 | 方案库（小红书收藏 · 剪贴簿） | 📋 方案定稿（2026-10-10）· 待开工 | [04-links-page.md](./04-links-page.md) |
| 05 | 前端功能剥离与骨架重置 | ✅ 完成（2026-10-10） | [05-skeleton-reset.md](./05-skeleton-reset.md) |
| 06 | 整体风格与设计 Token | ✅ 完成（2026-10-10） | [06-style-tokens.md](./06-style-tokens.md) |

状态标记：✅ 完成 · 🚧 进行中 · 📋 待开始 / 规划中 · ⛔ 受阻

## 系统全景

```
bear-home (Taro 小程序/H5)  ──HTTP + Bearer Token──▶  server/ (Hono + SQLite)
                                                          ▲
                                              MCP (Streamable HTTP)
                                                      Hermes Agent (待接入)
                                                          │
                                                      智谱 GLM (API)
```

- 后端访问：`http://119.27.191.90`（Caddy 80 端口，Token 鉴权）
- 数据库：SQLite 单文件，在服务器 `~/bear-home-server/data/`，备份即拷目录
- MCP 端点：`http://119.27.191.90/mcp`（8 个工具，已公网验证）

## 关键决策记录

- **自建轻量后端**而非微信云开发/Serverless：要跑异步任务和 Agent，且前后端统一 TypeScript（详见 01）
- **Agent 接开源 Hermes**而非裸调 LLM：用 MCP 标准接口对接，后端只暴露工具，不绑定任何 Agent 框架
- **数据源唯一化**：服务器是记录的唯一数据源，前端本地存储仅作离线缓存兜底
- **前端功能剥离（05）**：原前端功能多为 demo 写死数据，2026-10-10 全部移除只留跨端骨架；02 的前端接入层随之删除，待正式 PRD 后重建（后端与 02 的服务端部分仍然有效）
- **无备案域名过渡方案**：先走 `http://IP:80` 纯 HTTP + Token；有备案域名后改一行配置自动升级 HTTPS
