export default defineAppConfig({
  // Detail gestures own their transition; avoid a second H5 route animation.
  animation: false,
  pages: [
    "pages/inspiration/index",
    "pages/inspiration-detail/index",
    "pages/record/index",
    "pages/home/index",
    "pages/budget/index",
    "pages/profile/index",
    "pages/floorplan/index",
  ],
  window: {
    navigationStyle: "custom",
    // 与 tokens.css 的 --c-bg 保持一致（笔记/清单页会覆盖为纯白，属局部例外）
    backgroundColor: "#faf9f7",
    backgroundTextStyle: "dark",
  },
});
