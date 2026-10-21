# 清单模块动画机会评估

本次使用 find-animation-opportunities 做只读评估，动画建议尚未实施；视觉样式统一作为独立任务完成。React / Taro 跨 H5 与小程序，目前没有独立动画库。共享时长为 --dur-fast: 140ms、--dur-base: 240ms；--ease-out: cubic-bezier(0.23, 1, 0.32, 1)，--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)。已有按压、浮动按钮、弹层开合反馈，无需重复增加。

## 1. Opportunities

| # | Location | Today | Purpose | Frequency | Suggested motion |
| --- | --- | --- | --- | --- | --- |
| 1 | src/pages/record/index.tsx:252 | 更多信息直接出现 | State indication | 偶尔编辑，非键盘操作时 | 仅展开内容 opacity 0 → 1、translateY(4px) → 0，140ms cubic-bezier(0.23, 1, 0.32, 1)。不延迟表单可操作时间，保持按钮位置可预测。减少动态时仅 opacity，80ms ease-out；键盘触发不动画。 |
| 2 | src/pages/record/index.tsx:498 | 对比工具条突然出现 | Preventing a jarring change | 偶尔，进入对比模式 | opacity 0 → 1、translateY(6px) → 0，140ms cubic-bezier(0.23, 1, 0.32, 1)，退出同路径；保留已选条目反馈。减少动态时仅 opacity，80ms ease-out；键盘触发立即显示。 |
| 3 | src/pages/record/index.tsx:547 | 保存后新记录插入列表，位置瞬间变化 | Feedback | 偶尔保存新项 | 只对本次新增项 opacity 0 → 1，140ms cubic-bezier(0.23, 1, 0.32, 1)，已有数据不移动；不用于搜索或筛选结果。减少动态使用80ms opacity；键盘保存即时呈现。 |

三项均通过频率、目的、速度与功能门槛：都是偶发的明确状态改变，时长小于300ms，只触及 transform / opacity，不使正在阅读的数据移动。尚未实施，需真实交互验证感受。

## 2. Rejected candidates

- src/pages/record/index.tsx:400 — 分类筛选的整页滑动。Rejected: 高频操作，动效延迟查找；保留立即切换与现有按压反馈。
- src/pages/record/index.tsx:433 — 价格数字跳动、条目逐个错峰进入。Rejected: 功能门槛，阅读与比较的数据应稳定，动态数字和装饰性错峰干扰内容。
- src/pages/record/index.tsx:487 — 浮动加号持续呼吸/旋转。Rejected: 缺少有效目的，装饰占用注意力；现有按下反馈足够。
- src/pages/record/index.tsx:319 — 每次打开房间的大幅转场。Rejected: 每日多次的导航，功能门槛不通过，增加等待而没有必要的空间信息。

## 3. Verdict

清单只需要很少的动效。已有即时按压与对称弹层开合已覆盖主要反馈，最值得补充的是更多信息展开时的轻微淡入，让偶发的表单状态变化更容易理解。任何动效都不应阻塞输入。后续可以用 `improve-animations plan 更多信息展开的140ms淡入` 将第一项转成实施计划。
