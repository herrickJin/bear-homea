# 18 · 户型工具 · 数据源 + bear-home SVG 模块

状态：🚧 第一版 SVG 模块已上线（2026-10-21），typecheck + H5 构建通过，点选房间已验证。

用户决定：
- 放弃 `archive/floorplan-3d/`（废弃，不再作为底座）。
- 新工具放进 bear-home 走 Taro H5，第一版只做「还原原始建筑测量图」，不渲染方案家具。

## bear-home 侧交付

| 文件 | 作用 |
| --- | --- |
| `bear-home/src/pages/floorplan/index.tsx` | 页面：页首 + 工具条 + 绘图区 + 房间详情卡 + 数据来源说明 |
| `bear-home/src/pages/floorplan/FloorplanSVG.tsx` | SVG 渲染：房间底色 → 墙段 → 门窗洞 → 房间名/面积 → 选中描边 → N↑ 朝向标 |
| `bear-home/src/pages/floorplan/floorplan.css` | 页面样式；≤700 单列、>900 左图右卡 |
| `bear-home/src/pages/floorplan/types.ts` | walls.json / rooms.json 类型 |
| `bear-home/src/data/floorplan/walls.json` | ← `archive/floorplan-source/derived/walls.json`（72 墙 + 13 洞，GLB 直提权威版） |
| `bear-home/src/data/floorplan/rooms.json` | ← `archive/floorplan-source/derived/rooms.json`（命名 + 净 polygon） |
| `bear-home/src/app.config.ts` | 注册 `pages/floorplan/index` |
| `bear-home/src/pages/home/index.tsx` + `home.css` | 首页加「户型平面」入口卡片 |

**墙数据已切换口径**：最初用「房间净区边界反推的 37 段墙」，后被 GLB 直提的 72 段墙（内墙 19 / 外墙 35 / 墙腔 18）替代。
后者含 W63（客厅↔生活阳台隔墙，厚 279.2mm）等原方案里看不见的墙，且每段带真实厚度 —— **strokeWidth 直接用真实墙厚 mm**，任意缩放下视觉都正确。

## 已验证

- `npm run typecheck` 通过（tsc --noEmit 无错）
- `npm run build:h5` 通过（仅 Taro 固有 chunk size warning）
- H5 实测：9 个房间名 + 面积全部正确（客厅 46.56 / 主卧 15.94 / 北次卧 10.07 / 主卫 4.00 / 南次卧 9.40 / 储物间 6.57 / 公卫 2.13 / 厨房 5.33 / 生活阳台 8.54，合计 108.54 ㎡）
- 点选房间 → 详情卡显示尺寸/面积/ID/判定备注 ✓

## 2026-10-21 样式层修复

首次上线时 H5 渲染出来是「浏览器默认样式」：页首是默认按钮框、「房间名」是巨大黑体、
页脚说明是默认大号衬线体。SVG 里的墙和房间名正常（那是 SVG 自身的 fill/stroke），
所以看起来「能用」，但页面样式一条都没生效。

两个根因，都不是户型页自己的问题：

1. **token 没有载体**。`tokens.css` 把设计变量挂在 `page, .app-shell` 上，
   而 H5 里根本没有 `<page>` 元素（页面根是 `div.taro_page`），
   户型页又是唯一不挂 `<Screen>`（即没有 `.app-shell`）的页面 →
   `var(--c-*)` / `var(--sp-*)` 全部未定义，每条用到 var() 的规则都失效。
   修法：`tokens.css` 的选择器加 `:root` 兜底。`:root` 在小程序 WXSS 里会被忽略，
   `page` / `.app-shell` 照常承载，与既有的 H5 专有选择器 `.taro_page` 同一先例。
2. **Taro `<Button>` 缺少项目重置**。项目约定每个 Taro `<Button>` 都要挂 `ui-button`
   （提供 `display:inline-flex` 与 `::after{border:none}`），户型页三个按钮都漏了，
   导致返回按钮撑满整行、把标题挤出视口。修法：补 `ui-button`，
   并给 `.fp-back` 加 `width: fit-content`。

**教训**：新页面如果不走 `<Screen>`，样式会整页失效而不是「看起来差一点」——
typecheck 与构建都发现不了，只能肉眼比对。这次是靠「和生产站同视口截图逐字节比对」
才定位到的。

## 数据源（`archive/floorplan-source/`）

- `floordata0.glb` 8.65 MB（glTF 2.0）
- `ViewData.json`（房间多边形 + 面积 + 热点）
- `plan-123kanfang.png`（墙线图）
- `derived/walls.json` ★ 72 墙 + 13 门窗洞（含 checks 校验：场景包围盒与基准差 0.1mm、9 间房面积复算差 0.0000㎡）
- `derived/rooms.json` ★ 房间命名 / 净 polygon / 像素标定 / 热点
- `derived/furniture.json|md`、`materials.json|md` 方案参考档案（不进第一版 UI）
- `derived/extract_*.py`、`derive_walls_from_rooms.py` 可复现脚本

## 关键换算（必须背）

- 1 GLB 单位 = 10 mm
- `GLB_X_mm = ViewData_X × 10`，`GLB_Z_mm = −ViewData_Y × 10`（**Y 方向要翻**）
- 平面图像素：`px = X_glb + 927.508`，`py = Z_glb + 662.038`
- 朝向：GLB `+Z = 北`、`−X = 东`（据 `WechatIMG209.jpg` 指北针判定）
- 外轮廓 13412.5 × 11385.0 mm

## 三处待用户确认

1. **储物间/多功能角**（6.57 ㎡，GLB ID `XrCzEEni`）：123kanfang 封成电竞房，与「三室两厅两卫」冲突。图上带 `?` 标记。
2. **主卧进深** 4240 vs 4815 mm：差额 575 mm≈飘窗位，请复核测量基准。
3. **次卧／主卫／公卫命名**：`f1qYqHqH`=北次卧、`g3cnKYnd`=南次卧、`EX4vhDXo`=主卫、`qOPrZ97W`=公卫 均为按面积+家具+共墙推断（图上带 `?`），需现场校准。

另注：GLB 显示**阳台未与客厅打通**（W63 隔墙在），这与最初假设的「阳台打通」不符，如要打通属于方案阶段拆改。

## 下一步（未开工）

1. 尺寸标注层（对齐用户实测图的 13430/11360/6385/2795/3300 等轴线）
2. 家具开关（复用 `furniture.json` 做「方案对比视图」）
3. 3D 切换（载入 `floordata0.glb`，建议独立 Vite 子应用，避免把 Three.js 塞进 Taro）
