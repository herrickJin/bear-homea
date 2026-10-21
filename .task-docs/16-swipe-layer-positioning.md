# 手机右滑：前景详情消失的根因与修正（2026-10-18）

用户确认 Edge/Safari 手机端均出现：拖动不显示当前详情，直接显示返回后的列表。

真实触控输入在生产环境复现：手指右拖100px，详情的矩形为 x=100、y=844、390×844，命中测试为 false；URL仍为详情。原因是此前关闭 Taro 路由动画，也同时关闭了其提供的 absolute 页面定位。显示上一页时，两个 .taro_page 都在普通文档流中，上一页将详情向下推了一整屏。此前只断言 translateX，没有检查 top 或实际像素命中，导致测试漏报。

修正：仅在交互期间将 .note-back-underlay 和 .note-back-foreground 固定到视口，显式指定宽高与 z-index=0/1；前景详情保持在上一页之上，只有横向位移。回弹或退出后恢复原布局。

验证：
- 相同真实触控输入，修正后矩形 x=100、y=0、390×844；前景命中为 true。已查看前后截图。
- scripts/check-safari-swipe.mjs 已改为跨引擎 CLI 回归。Chromium使用可信触控输入，WebKit使用触摸事件回放。
- 检查拖动50px、100px时，横向位置准确，纵向位置始终0；详情内容可见、没有提前导航。
- 按住150ms不导航；短拖松手回弹至0；长拖松手后返回；返回后清理定位类和 inert。
- Chromium/WebKit本地测试通过；类型检查、H5/小程序构建通过。

该布局错误才是此次用户反馈的直接根因；先前Safari事件接管推断没有充分解释跨浏览器的“详情消失”现象。

线上复测：https://visionboards.cn/ 的 Chromium 与 WebKit 回归均通过，held={x:100,y:0,detailVisible:true,onDetail:true}；短拖回弹、长拖松手返回、状态清理均通过。
