import { defineConfig } from "@tarojs/cli";

// TARO_APP_* 自定义变量：Taro 的 DefinePlugin 只把 config.env 里的键生成为
// process.env.<KEY> 替换。构建环境没有 .env 时这些引用会原样打进 chunk，
// 浏览器无 process → 笔记页 chunk 抛 ReferenceError 白屏。
// 这里显式给默认空串（= mock 模式）；真实值由构建环境变量/defineConstants 覆盖。
const appEnv: Record<string, string> = {};
for (const key of ["TARO_APP_API_BASE", "TARO_APP_API_TOKEN"]) {
  appEnv[key] = JSON.stringify(process.env[key] ?? "");
}

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
  env: appEnv,
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
