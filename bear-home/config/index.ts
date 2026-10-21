import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "@tarojs/cli";

// TARO_APP_* 自定义变量：Taro 的 DefinePlugin 只把 config.env 里的键生成为
// process.env.<KEY> 替换。构建环境没有 .env 时这些引用会原样打进 chunk，
// 浏览器无 process → 笔记页 chunk 抛 ReferenceError 白屏。
// 这里显式给默认空串（= mock 模式）；真实值由构建环境变量/defineConstants 覆盖。
const appEnv: Record<string, string> = {};
for (const key of ["TARO_APP_API_BASE", "TARO_APP_API_TOKEN"]) {
  appEnv[key] = JSON.stringify(process.env[key] ?? "");
}

// H5 development uses the local AI backend; its token stays in the dev proxy.
const localAiDev = process.env.NODE_ENV !== "production" && process.env.TARO_ENV === "h5";
// AI 单次动作（整理草稿、选购分析）共用一个地址：显式 AI base > 旧名 RECORD_AI_BASE
// > 开发代理 /record-ai（令牌由代理注入）> 主 API。旧名保留，避免既有 .env 失效。
const aiBase =
  process.env.TARO_APP_AI_BASE ??
  process.env.TARO_APP_RECORD_AI_BASE ??
  (localAiDev ? "/record-ai" : process.env.TARO_APP_API_BASE ?? "");
appEnv.TARO_APP_AI_BASE = JSON.stringify(aiBase);
appEnv.TARO_APP_RECORD_AI_BASE = JSON.stringify(aiBase);
let localServerToken = process.env.BEAR_HOME_TOKEN ?? "";
if (localAiDev && !localServerToken) {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, "../../server/.env"), "utf8");
    localServerToken = raw.match(/^\s*BEAR_HOME_TOKEN\s*=\s*(.*?)\s*$/m)?.[1]?.replace(/^["']|["']$/g, "") ?? "";
  } catch { /* An unconfigured backend reports unavailable. */ }
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
    devServer: {
      host: "0.0.0.0", port: 5173, allowedHosts: "all",
      proxy: localAiDev ? {
        "/record-ai": {
          target: "http://127.0.0.1:8787",
          pathRewrite: { "^/record-ai": "" },
          headers: { Authorization: `Bearer ${localServerToken}` },
        },
      } : undefined,
    },
    postcss: { pxtransform: { enable: false } },
    htmlPluginOption: { title: "熊熊之家 · 装修记录" },
  },
});
