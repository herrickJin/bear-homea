# 05 · 前端功能剥离与骨架重置

**状态**：✅ 完成（2026-10-10）

## 背景

原 bear-home 中除「记录增 + 查」外均为 mock/demo 写死数据（进度条、预算、我的页等），与正式需求不符。决定全部剥离，只留跨端骨架，等正式功能方案确定后重建。

## 移除清单

| 项 | 说明 |
|----|------|
| `src/services/` | API 请求层（api.ts）与记录服务（entries.ts），含 `TARO_APP_*` 环境变量引用 |
| `src/data/demo.ts` | demo 记录、阶段列表、示例预算项 |
| `src/components/EntryEditor.tsx` | 新增记录弹层 |
| `Screen.tsx` 功能块 | 进度条（写死 3/7 阶段）、预算小结（写死 ¥24,800/¥180,000）、记录列表、阶段筛选、「我的」假数据、DEMO 徽标、toast |
| `styles.css` 功能样式 | hero/stage/entry/budget/memo/filters/profile/editor/toast 等，1676 行 → 约 600 行 |

## 保留清单

- 4 页面结构与自定义导航（侧边栏 / 顶栏面包屑 / 底部导航）
- 应用外壳布局与三档响应式断点、小程序胶囊安全区
- CSS 小熊、图标库、设计变量、panel/empty 等通用原子
- 构建链与类型检查

**未改动**：server/ 后端、archive/（已废弃）、.task-docs 既有任务。

## 验证记录（2026-10-10）

- `npm run typecheck` 通过；`npm run build:h5` 通过（CSS 6.74 KiB）；`npm run dev:h5` 编译 0 错误（需 Node ≥ 20）
- dist 全量字符串扫描：新骨架文案在 4 个页面 chunk 中；旧功能文案（记一笔 / 示例账本 / ¥180,000 等）0 残留
- headless Chrome DOM 导出：4 页 h1/eyebrow 正确，均渲染「功能重设计中」空态，无旧元素
- 布局断言（CDP 仿真 375 / 768 / 1440）：均无横向滚动、面板不溢出、小熊居中、断点切换正确、旧功能为 0
- 桌面 1440 截图目检通过（注：该版 headless Chrome `--window-size=375` 被钳到 500 且仿真不反映到截图面，手机端以布局实测为准）

## 后续

- [ ] 与用户确认正式功能方案（PRD），逐页重建
- [ ] 重建时按需恢复 API 对接（server/ 与 token 配置均可用）
