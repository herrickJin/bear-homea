# bear-home 目录结构清单

> 生成时间：2026-10-18 · 生成方式：只读盘点（未改动任何现有文件）
> 项目：bear-home v0.3.0 —— 基于 Taro 4.3 + React 18 的多端（H5 / 微信小程序）家居应用

## 一、目录树（两层）

```text
bear-home/
├── .mimosa/                  # 工具状态目录
│   ├── finding-ledger/
│   ├── history/
│   ├── hook-state/
│   ├── hook-status/
│   └── reports/
├── .swc/                     # SWC 编译缓存
│   └── plugins/
├── config/
│   └── index.ts
├── dist/                     # 构建产物
│   ├── assets/
│   ├── h5/
│   │   ├── chunk/  css/  js/  static/
│   │   └── index.html
│   ├── weapp/                # 微信小程序产物
│   │   ├── assets/  pages/
│   │   └── app.js / app.json / app.wxss / ...
│   └── index.html
├── docs/
│   ├── backend-alignment-audit.md
│   ├── preparation-server-sync.md
│   ├── project-overview.md
│   ├── record-motion-opportunities.md
│   └── room-preparation-flow.md
├── scripts/
│   ├── check-safari-swipe.mjs
│   ├── generate-icons.cjs
│   └── xiaohongshu.svg
├── src/
│   ├── .mimosa/
│   │   ├── hook-state/
│   │   └── hook-status/
│   ├── assets/
│   │   ├── icons/
│   │   └── rooms/
│   ├── components/           # 13 个组件
│   ├── data/                 # 5 个 mock/数据模块
│   ├── hooks/                # 2 个自定义 hook
│   ├── pages/                # 6 个页面：budget / home / inspiration /
│   │                         #   inspiration-detail / profile / record
│   ├── services/             # 6 个服务模块
│   ├── styles/               # 5 个样式文件
│   ├── app.config.ts / app.tsx / index.html / styles.css / types.d.ts
│   └── ...
├── tests/
│   ├── central-ac-import.test.ts
│   └── preparation.test.ts
├── DESIGN.md / README.md
├── package.json / package-lock.json
├── project.config.json / tsconfig.json / tsconfig.tsbuildinfo
├── babel.config.js / .nvmrc / .gitignore
├── .env / .env.example / .DS_Store
└── node_modules/             # 依赖（793 项，未计入统计）
```

## 二、顶层条目说明

| 条目 | 类型 | 说明 |
| --- | --- | --- |
| `.mimosa/` | 目录 | Mimosa 工具的本地状态（hook 状态、历史、报告、finding 台账） |
| `.swc/` | 目录 | SWC 编译器缓存/插件目录 |
| `config/` | 目录 | Taro 构建配置（`index.ts`） |
| `dist/` | 目录 | 构建产物：H5（`h5/`）与微信小程序（`weapp/`）两套输出 |
| `docs/` | 目录 | 项目文档：概览、后端对齐审计、房间准备流程、记录动效等 5 篇 |
| `scripts/` | 目录 | 辅助脚本：Safari 滑动检查、图标生成、小红书 SVG 素材 |
| `src/` | 目录 | 源码主体：Taro + React 应用（页面/组件/服务/样式/数据/资源） |
| `tests/` | 目录 | 测试：中央空调导入、房间准备流程 2 个测试文件 |
| `node_modules/` | 目录 | npm 依赖安装目录（不入库） |
| `DESIGN.md` | 文件 | 设计文档（约 30KB） |
| `README.md` | 文件 | 项目说明 |
| `package.json` / `package-lock.json` | 文件 | 依赖与脚本定义（dev/build/typecheck/icons） |
| `project.config.json` | 文件 | 微信小程序项目配置 |
| `tsconfig.json` / `tsconfig.tsbuildinfo` | 文件 | TypeScript 配置与增量编译缓存 |
| `babel.config.js` | 文件 | Babel 配置 |
| `.nvmrc` | 文件 | Node 版本锁定 |
| `.gitignore` | 文件 | Git 忽略规则 |
| `.env` / `.env.example` | 文件 | 环境变量（本地实际值 / 示例模板） |
| `.DS_Store` | 文件 | macOS 系统文件（非项目内容） |

## 三、文件 / 目录计数

统计口径：排除 `node_modules`（793 个依赖包）与 `.DS_Store`。

| 指标 | 数量 |
| --- | --- |
| 目录总数（不含 node_modules） | 61 |
| 文件总数（不含 node_modules） | 291 |
| 顶层条目（不含 node_modules） | 24 |

分目录明细：

| 目录 | 文件数 | 子目录数 |
| --- | --- | --- |
| `src/` | 116 | 20 |
| `.mimosa/` | 93 | 13 |
| `dist/` | 58 | 20 |
| `docs/` | 5 | 1 |
| `scripts/` | 3 | 1 |
| `tests/` | 2 | 1 |
| `config/` | 1 | 1 |
| `.swc/` | 1 | 3 |
| 根目录散置文件 | 12 | — |

src 内部细分：components 13 个文件、pages 10 个（6 个页面）、services 6 个、styles 5 个、data 5 个、hooks 2 个、assets 66 个（icons + rooms 图片资源）。
