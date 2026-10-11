import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Hono } from "hono";
import { config } from "./config.js";
import { mcpApp } from "./mcp/server.js";
import { auth } from "./middleware/auth.js";
import { entries } from "./routes/entries.js";
import { links } from "./routes/links.js";
import { categories } from "./routes/categories.js";
import { files, uploads } from "./routes/uploads.js";
import { chat } from "./routes/chat.js";

// CORS 白名单：环境变量里的精确来源（默认含 vite 5173），
// 外加本机/局域网 http 来源（手机连同一 Wi-Fi 调试 H5 的场景）。
const extraOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const lanOrigin = /^http:\/\/(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof SyntaxError) {
    return c.json({ error: "请求体不是合法 JSON" }, 400);
  }
  console.error(err);
  return c.json({ error: "服务器内部错误" }, 500);
});

app.use(
  "*",
  cors({
    origin: (origin) =>
      origin && (extraOrigins.includes(origin) || lanOrigin.test(origin))
        ? origin
        : null,
    allowHeaders: ["Authorization", "Content-Type"],
  }),
);

app.get("/", (c) => c.json({ name: "bear-home-server", version: "0.1.0" }));
app.get("/api/health", (c) => c.json({ ok: true }));

// 以下全部需要 Bearer Token
app.use("/api/*", auth());
app.use("/mcp", auth());
app.route("/api/entries", entries);
app.route("/api/links", links);
app.route("/api/categories", categories);
app.route("/api/uploads", uploads);
app.route("/api/chat", chat);
app.route("/mcp", mcpApp);

// 文件读取免鉴权：UUID 不可枚举即为凭证（capability URL）
app.route("/files", files);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`bear-home-server 已启动: http://localhost:${info.port}`);
});
