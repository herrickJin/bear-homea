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
    backgroundColor: "#f7f9f6",
    backgroundTextStyle: "dark",
  },
});
