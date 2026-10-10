import { defineConfig } from "@tarojs/cli";
export default defineConfig({
  projectName: "bear-home",
  date: "2026-10-10",
  designWidth: 375,
  deviceRatio: { 375: 2, 640: 1.17, 750: 1, 828: 0.905 },
  sourceRoot: "src",
  outputRoot: `dist/${process.env.TARO_ENV || "h5"}`,
  framework: "react",
  compiler: "webpack5",
  cache: { enable: false },
  mini: { postcss: { pxtransform: { enable: false } } },
  h5: {
    publicPath: "/",
    staticDirectory: "static",
    router: { mode: "hash" },
    devServer: { host: "0.0.0.0", port: 5173, allowedHosts: "all" },
    postcss: { pxtransform: { enable: false } },
    htmlPluginOption: { title: "熊熊之家 · 装修记录" },
  },
});
