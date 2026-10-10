# 02 · 前端（bear-home）接入后端 API

**状态**：✅ 完成（2026-10-10）

## 范围

bear-home（Taro 小程序/H5）从"本机存储 Demo"改为"服务器为唯一数据源"，本地存储降级为离线缓存。

## 已交付

- **新增 `src/services/api.ts`**：Taro.request 封装；`API_BASE_URL` / `API_TOKEN` 集中配置（当前指向 `http://119.27.191.90`）；统一 Bearer 头；`ApiError` 带状态码
- **重写 `src/services/entries.ts`**：
  - `readEntries()`：同步读本地缓存（首屏即时渲染），保留 demo 数据兜底
  - `loadEntries()`：`GET /api/entries?limit=200` → 刷新缓存 → 返回；网络失败静默回退缓存
  - `createEntry(title, body, stage)`：改为 async，`POST /api/entries`，成功后同步缓存；失败抛错
- **`src/components/Screen.tsx`**：`useDidShow` 异步刷新；新增流程失败时提示"网络不佳"且**保持弹窗打开不丢内容**；"我的"页文案更新为多端同步
- **`src/components/EntryEditor.tsx`**：底注改为"保存到小家的服务器"
- **服务器配合改动**：CORS 白名单在精确来源（localhost:5173）之外，放行本机/局域网 http 来源（`lanOrigin` 正则）——支持手机连同一 Wi-Fi 调试 H5。已重新部署生效

## 验证记录（2026-10-10，真实浏览器 E2E）

Playwright 打开 `localhost:5173` → 首页渲染出服务器记录「部署日：熊熊之家后端上线」→ UI 点"记一笔"新增记录 → 跳转记录页显示 → API 确认入库 → 控制台 0 错误 0 警告。测试数据已清理（服务器现存 1 条真实记录）。

**同日联通性复测（Token 迁移 .env 后）**：health / 401 鉴权 / entries 读写（UI POST → 201 → 入库 → 已清理）/ MCP initialize / CORS 预检全部通过；确认 `TARO_APP_*` 环境变量注入正常，浏览器真实请求打到服务器。顺带发现：`useDidShow` 每次页面显示都全量拉 limit=200，自用可接受，后续可加节流。

## 注意事项

- **Node 版本**：需要 Node ≥ 20（项目根 `.nvmrc` 已固定 v23.8.0，`nvm use` 即可）。用 Node 16 启动会白屏：postcss-import 依赖 `Array.findLastIndex`（Node 18+），编译报 `bundle.findLastIndex is not a function`（2026-10-10 联通性复测时踩中）
- **微信开发者工具**联调需勾选「不校验合法域名」（当前 http IP）；正式发布必须 HTTPS + 备案域名
- **Token** 已从源码硬编码改为 `bear-home/.env`（`TARO_APP_API_BASE` / `TARO_APP_API_TOKEN`，Taro 构建时注入，模板见 `.env.example`，不入 git）；服务器轮换 Token 后同步改 `.env` 重建即可
- **老数据覆盖**：设备上旧的本地记录会在首次成功拉取后被服务器数据覆盖（服务器是唯一数据源）
- 预算页仍是示例数据（服务器暂无预算表），待需求确认后设计
- 离线场景：`loadEntries` 失败读缓存、`createEntry` 失败提示且不关弹窗——**无离线写队列**，断网时新增的记录不会自动补传（自用场景接受）

## 待办（本任务遗留）

- 小程序真机（开发者工具 + 体验版）实测：npm 构建 ≠ 真机验证，需用户在微信开发者工具里编译预览确认
