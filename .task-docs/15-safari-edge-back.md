# iPhone / iPad Safari 边缘返回修正（2026-10-18）

用户实测反馈上一版没有跟手动效，明确环境为 iPhone/iPad Safari。前次 PointerEvent 合成测试没有覆盖 Safari 原生边缘导航与应用事件流之间的冲突，因此不能作为真机手感通过的依据。

本次先建立 TouchEvent 回归：旧代码在边缘 touchstart 未调用 preventDefault（claimed=false），连续拖动时位置均为0。新代码在独立的左侧28px起滑区注册非 passive 的 touchstart/move/end；在起手时阻止 Safari 抢走原生导航，连续移动立即更新整页 transform。页面其余区域保留滚动、缩放和图片轮播。

行为：左边缘右拖1:1跟手；手指未松开时永不导航；慢拖超过40%宽度松手完成；至少64px且向右释放速度≥0.65px/ms时支持快速甩回；向左反拉、短拖、touchcancel回弹。上一页以24%比例视差露出；不提前切路由或重载列表。减少动态效果时保留透明度反馈。

验证：
- scripts/check-safari-swipe.mjs 为可重复执行的浏览器回归，先失败后通过：claimed=true，拖动40/90px分别位移40/90px；短拖松手回到0；长拖按住不导航、松手才返回。
- WebKit26.4 iPhone尺寸环境触摸事件回放：50/100px拖动分别位移50/100px，起手preventDefault生效、短拖回弹、长拖松手返回。
- /tmp/bear-safari-mid-drag.png 已查看，确认拖动中显示真实列表和当前详情，具有视差层次。
- 类型检查、H5与小程序构建通过。
- WebKit环境回放不等同于真实iPhone的OS级导航手势，Safari真机最终手感仍待用户体验。

参考：Apple Safari Handling Events；WebKit bug240892记录了iOS在touchstart调用preventDefault来阻止导航的处理方式。
