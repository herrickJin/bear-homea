# 归档（已废弃）

**状态：🚫 DEPRECATED — 已废弃，不再维护，后续不再查看。**（2026-10-10 归档）

本目录存放 home-design 工作区中已停止投入的子项目。代码保留在这里仅供追溯，不参与任何开发、评审或任务规划。

| 目录 | 原功能 | 状态 |
|------|--------|------|
| `floorplan-3d/` | 纯前端户型装修设计工具（单 HTML，2D 平面布置 + Three.js 3D 漫游、造价估算） | 🚫 已废弃 |
| `vf-viewer/` | visualize-floorplans 数据查看器（vf-convert.py + three.js 双面板） | 🚫 已废弃 |

## 归档说明

- 两个目录于 2026-10-10 从仓库根目录移入 `archive/`。
- `floorplan-3d/` 是独立 git 仓库，主仓库 `.gitignore` 已忽略它（归档后同样忽略）。
- `vf-viewer/` 由主仓库跟踪，移动以 git 重命名记录（`git mv`），未提交前可用 `git restore --staged` 恢复。
- 有效项目仅剩：`bear-home/`（跨端 App）、`server/`（自托管后端）、`.task-docs/`（任务文档）。
