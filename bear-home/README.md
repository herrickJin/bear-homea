# 熊熊之家 · 跨端应用

Taro 4 + React 18 + TypeScript，一套页面输出微信小程序和 H5（手机、Pad、PC）。

**当前状态（2026-10-21）**：已从 2026-10-10 的「纯骨架」进入功能落地阶段。
笔记库、装修准备（含 AI 草稿与选购分析）、户型工具三块已可用并接后端；
预算、我的仍是占位页；App 内 AI 对话 UI 未开工。

后端在相邻的 `../server/`（Hono + SQLite），本项目是它的唯一前端。

## 已实现的功能

| 模块 | 入口 | 状态 |
| --- | --- | --- |
| 笔记库 | `pages/inspiration` | 小红书式瀑布流、分类管理、原地详情弹层、多图、备注时间线、搜索 |
| 装修准备 | `pages/record` | 按房间组织的准备项与候选、多图候选、服务端同步、AI 草稿与选购分析 |
| 户型工具 | `pages/floorplan` | 还原原始建筑测量图：墙段、门窗洞、房间名与面积、点选详情 |
| 小家 | `pages/home` | 工具入口页（当前挂「户型平面」卡片） |
| 预算 / 我的 | `pages/budget` `pages/profile` | 占位页（`功能重设计中`） |

导航只保留 **笔记 / 清单** 两项；小家、户型、预算、我的通过侧栏品牌位或首页卡片进入。

### 数据从哪来

`src/services/` 是唯一的数据访问层，每个函数内部按是否配置了后端分流：

- **已配置 `TARO_APP_API_BASE`**：走 `../server/`，服务器是唯一数据源
- **未配置**：回退内存 mock，UI 不因断网而废（但不具备持久保存能力）

装修准备另有一套同步逻辑（`src/pages/record/usePreparationSync.ts`）：
revision 乐观锁 + 待同步草稿落本地 storage + 409 冲突时保留草稿不覆盖 + 本地缓存兜底。

### AI 能力

两个单次、不落库的后端接口：

- `POST /api/record-draft` —— 随手记 → 选购草稿，用户确认后才保存
- `POST /api/analyze` —— 候选 → 选购分析，可保存到该候选

地址由 `TARO_APP_AI_BASE` 配置（旧名 `TARO_APP_RECORD_AI_BASE` 仍兼容）。

## 本地网页预览

```sh
cd bear-home
nvm use            # 需要 Node ≥ 20（.nvmrc 已固定 v23.8.0；Node 16 会因 postcss-import 的 findLastIndex 缺失而编译白屏）
npm install
npm run dev:h5
```

电脑打开 http://localhost:5173 。手机 / Pad 和电脑连接同一 Wi-Fi，访问电脑的局域网地址。路由采用 hash 模式，静态部署不需要服务端重写。

开发时 H5 的 AI 请求走 `/record-ai` 代理转发到本地 `127.0.0.1:8787`，
后端令牌由 `config/index.ts` 代理注入，前端不接触明文令牌。

## 环境变量

复制 `.env.example` 为 `.env`（`.env` 不提交 git）：

| 变量 | 说明 |
| --- | --- |
| `TARO_APP_API_BASE` | 后端地址，如 `https://visionboards.cn`；留空则前端走内存 mock |
| `TARO_APP_API_TOKEN` | 后端 `BEAR_HOME_TOKEN`，请求以 `Authorization: Bearer` 发送 |
| `TARO_APP_AI_BASE` | AI 单次动作接口地址；不设则复用 `TARO_APP_API_BASE` |
| `TARO_APP_RECORD_AI_BASE` | 旧名，仅在 `TARO_APP_AI_BASE` 未设时作为兜底 |

小程序正式版要求 HTTPS + 备案域名；当前 `http://IP` 形式仅用于开发者工具
（勾选「不校验合法域名」）和 H5。

## 微信小程序

```sh
npm run dev:weapp
```

打开微信开发者工具，导入 **bear-home 项目根目录**（包含 `project.config.json` 的目录）。AppID 已配置为 `wxb7ec6b9b87815efd`。模拟器编译和手机真机预览需分别检查。

小程序使用自定义顶部和底部导航，顶部通过微信胶囊位置和状态栏高度计算安全空间。

## 构建与检查

```sh
npm run typecheck
npm run test          # node:test 跑 tests/
npm run build:h5      # dist/h5/
npm run build:weapp   # dist/weapp/
npm run build         # 类型检查 + 测试 + 两端构建
```

## 目录

- `config/index.ts`：编译、开发服务（含 AI 代理）、双端输出配置。
- `src/app.config.ts`：七个页面与自定义导航配置。
- `src/pages/`：各页面入口，统一由 `<Screen page="..." />` 提供外壳。
- `src/components/`：`Screen.tsx` 应用外壳、`SheetHeader.tsx` 弹层顶栏、`LinkDetailSheet.tsx` 笔记详情、`Icons.tsx` 图标等。
- `src/services/`：数据访问层（`api.ts` 基础请求、`inspiration.ts` 笔记、`preparation.ts` 准备数据、`analyze.ts` / `recordDraft.ts` AI 单次动作）。
- `src/hooks/`：`useSheetMotion.ts` 弹层进出动画、`useSwipeBack.ts` 手势返回。
- `src/styles/tokens.css`：设计 Token 唯一真源（色彩/排印/间距/圆角/阴影/动效）。
- `src/styles.css` + `src/styles/`：外壳样式与各功能页样式，全部消费 token。
- `src/data/`：mock 数据、准备项种子、户型数据。
- `DESIGN.md`：视觉方向与设计规范（改样式前必读）。
- `docs/project-overview.md`：项目全景与阅读注意事项。
- `docs/plans/global-renovation-plan.md`：小家装修计划与 Agent 助理设计稿（未实施）。

`npm run icons` 可重新生成图标。lucide-react 和 sharp 仅用于开发时生成资源，不进入运行时页面。

## 已知问题

- `src/components/Ledger*.tsx`、`src/services/ledger.ts`、`src/data/mockLedger.ts`
  是旧「选购台账」实现，新清单页已不引用，尚未删除。
- `DESIGN.md` 按时间顺序追加章节，冲突处以后出现的章节为准。
- `src/app.config.ts` 的小程序原生底色 `#f7f9f6` 与 token `--c-bg` 不一致。
