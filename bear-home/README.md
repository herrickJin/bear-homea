# 熊熊之家 · 跨端骨架

Taro 4 + React 18 + TypeScript，一套页面输出微信小程序和 H5（手机、Pad、PC）。

**当前状态：纯骨架（2026-10-10 功能剥离）**。原有的演示功能（装修记录增查、进度条、预算页、示例数据、API 接入层）已全部移除，等待正式功能重新设计。保留的是跨端外壳与导航结构。

## 保留的骨架

- 4 个页面：小家（home）、记录（diary）、预算（budget）、我的（profile），页面内容为「功能重设计中」空态
- 应用外壳：品牌侧边栏（PC/Pad）、顶栏面包屑、手机底部导航、页面标题区
- 跨端能力：微信小程序胶囊安全区适配、三档响应式断点（≤700 手机 / 701–1100 Pad / >1100 PC）
- 视觉资产：CSS 小熊、PNG 图标库、设计变量与通用面板样式
- 构建链：双端输出、类型检查、图标生成脚本

## 已移除（待重新设计后按需重建）

- `src/services/`（API 请求层与记录服务）——后端 server/ 仍然可用，重建时直接对接
- `src/data/demo.ts`（示例记录与示例预算）
- `src/components/EntryEditor.tsx`（新增记录弹层）
- `Screen.tsx` 中的进度条、预算小结、记录列表、阶段筛选、我的页假数据
- `styles.css` 中对应的功能样式（1676 行 → 约 600 行外壳与原子）

详见 [.task-docs/05-skeleton-reset.md](../.task-docs/05-skeleton-reset.md)。

## 本地网页预览

```sh
cd bear-home
nvm use            # 需要 Node ≥ 20（.nvmrc 已固定 v23.8.0；Node 16 会因 postcss-import 的 findLastIndex 缺失而编译白屏）
npm install
npm run dev:h5
```

电脑打开 http://localhost:5173 。手机 / Pad 和电脑连接同一 Wi-Fi，访问电脑的局域网地址。路由采用 hash 模式，静态部署不需要服务端重写。

## 微信小程序

```sh
npm run dev:weapp
```

打开微信开发者工具，导入 **bear-home 项目根目录**（包含 `project.config.json` 的目录）。AppID 已配置为 `wxb7ec6b9b87815efd`。模拟器编译和手机真机预览需分别检查。

小程序使用自定义顶部和底部导航，顶部通过微信胶囊位置和状态栏高度计算安全空间。

## 构建

```sh
npm run typecheck
npm run build:h5      # dist/h5/
npm run build:weapp   # dist/weapp/
npm run build        # 类型检查 + 两端构建
```

## 目录

- `config/index.ts`：编译、开发服务和双端输出配置。
- `src/app.config.ts`：四个页面与自定义导航配置。
- `src/pages/`：四个页面入口（各自渲染 `<Screen page="..." />`）。
- `src/styles/tokens.css`：设计 Token 唯一真源（色彩/排印/间距/圆角/阴影/动效）。
- `src/styles.css`：骨架样式，全部消费 token。
- `DESIGN.md`：视觉方向与设计规范（重建功能页前必读）。
- `src/components/Screen.tsx`：应用外壳与页面容器（功能剥离后的唯一主组件）。
- `src/components/Bear.tsx`：CSS 小熊。
- `src/components/Icons.tsx`、`src/assets/icons/`：跨端 PNG 图标。
详见 [DESIGN.md](./DESIGN.md)。

`npm run icons` 可重新生成图标。lucide-react 和 sharp 仅用于开发时生成资源，不进入运行时页面。
