# 03 · 接入 Hermes Agent

**状态**：✅ 已上线（2026-10-12 部署并全链路验证）· 剩网关/cron 未配

> 2026-10-12 部署记录：服务器直拉镜像成功（腾讯镜像源有 `nousresearch/hermes-agent:stable`，
> 无需 Mac 导入）；**无需交互向导**——镜像 `HERMES_HOME=/opt/data` 自举，模型与 MCP 由
> `deploy/hermes/bootstrap.sh` 注入（幂等）。全链路验证：`hermes -z` 模型连通（glm-5.3·zai）✅、
> `mcp list` 8 工具 ✓ enabled ✅、链接队列 pending→抓取→title/summary/content 写回→done ✅
> （首测暴露过「空内容标 done」，严格 SOP 提示后复测正确）。hermes 容器空闲内存 ~116MB。
> 实操坑全记录在 `server/deploy/hermes/README.md` 第 4 节。
>
> 2026-10-12 更新：AI 接入定稿为**双通道**——App 内实时探讨走 server 自建 `/api/chat`
>（已上线验证，见 08）；本任务的 Hermes 容器负责常驻异步智能（链接队列、cron、网关）。

## 目标

在服务器上跑开源自托管智能体 [Hermes Agent](https://hermes-agent.nousresearch.com/docs/zh-Hans)（Nous Research，MIT），通过 **MCP** 操作熊熊之家的数据，实现：小红书链接自动抓取总结、装修阶段自动打标、定时预算汇总推送。

## 方案要点（已确认）

- **对接方式 = MCP 标准接口**，后端已就绪：`http://119.27.191.90/mcp`（8 个工具，公网验证通过）。不绑定 Agent 框架，以后换/加 Agent 不改后端
- Hermes 以**独立容器**加入 `server/docker-compose.yml`（文件里已留注释模板），与 server 同网络，MCP 走内网 `http://server:8787/mcp` + Bearer Token
- **模型走智谱 GLM**（OpenAI 兼容端点）：这台服务器 OpenAI/Docker Hub 不可达，智谱实测 ~100ms；Hermes 支持"任意 OpenAI 兼容端点"
- **安全边界**：Hermes 能执行代码，必须跑在独立容器里（其支持 Docker 后端隔离），不与 server 共享文件系统写权限；只通过 MCP + Token 访问数据

## 链接处理约定（Agent 标准流程）

1. `list_links` 取 `status=pending` 的任务
2. `update_link(id, status="processing")`
3. 用 Hermes 内置网页抓取能力读取 url，产出 `title` / `summary` / `cover_url`（可选 `content` 全文）
4. `update_link(id, {..., status="done"})`；失败 `status="failed"` + `error`

## 步骤

- [x] 确认 Hermes 的容器化部署方式（官方镜像 `nousresearch/hermes-agent`，`stable` tag；**服务器直拉成功**，Mac 导入仅作兜底）（2026-10-12）
- [x] 写入 docker-compose.yml hermes 服务（profiles 隔离，默认不影响现有部署）+ bootstrap.sh 注入模型（zai/glm-5.3/coding 端点）与 MCP（内网地址 + Token）（2026-10-12）
- [x] 服务器实装：backup.sh → rsync → `--profile hermes up -d` → bootstrap.sh → restart（2026-10-12）
- [x] 端到端验证：App 存一条链接 → Hermes 抓取写回（title/summary/content）→ status=done → App 展示（2026-10-12）
- [ ] 配置消息网关（微信/Telegram 选一，用于不开 App 直接使唤 Agent）
- [ ] cron 周报（会话里自然语言配置即可，SOUL 已写好格式）
- [x] 资源观察：hermes 容器空闲 ~116MB，2C/2G 无压力（2026-10-12）

## 风险

- 小红书反爬：Hermes 网页提取可能被拦，备选方案是让它走浏览器工具或人工粘贴正文
- 国内拉 Hermes 相关镜像/依赖可能受限，做好手动导入准备
