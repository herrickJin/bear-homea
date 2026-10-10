import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, now, today } from "../db/index.js";
import type { EntryRow, LinkRow } from "../db/schema.js";

const text = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const toolError = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true as const,
});

const getEntry = (id: string): EntryRow | undefined =>
  db.prepare(`SELECT * FROM entries WHERE id = ?`).get(id) as EntryRow | undefined;
const getLink = (id: string): LinkRow | undefined =>
  db.prepare(`SELECT * FROM links WHERE id = ?`).get(id) as LinkRow | undefined;

/** 每次请求新建一个无状态 server 实例（官方推荐的无会话模式）。 */
function buildServer(): McpServer {
  const server = new McpServer({ name: "bear-home", version: "0.1.0" });

  server.registerTool(
    "list_entries",
    {
      title: "查询装修记录",
      description: "列出装修记录，可按阶段筛选（准备/拆改/水电/泥木/油漆/安装/入住）",
      inputSchema: {
        stage: z.string().describe("按阶段筛选，不传则返回全部").optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    ({ stage, limit, offset }) => {
      const cap = Math.min(limit ?? 50, 200);
      const off = offset ?? 0;
      const rows = (
        stage
          ? db
              .prepare(
                `SELECT * FROM entries WHERE stage = ? ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`,
              )
              .all(stage, cap, off)
          : db
              .prepare(
                `SELECT * FROM entries ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`,
              )
              .all(cap, off)
      ) as EntryRow[];
      return text({ total: rows.length, entries: rows });
    },
  );

  server.registerTool(
    "search_entries",
    {
      title: "搜索装修记录",
      description: "按关键词模糊搜索记录的标题和正文",
      inputSchema: {
        keyword: z.string().describe("关键词"),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    ({ keyword, limit }) => {
      const q = `%${keyword.replace(/[%_]/g, "")}%`;
      const rows = db
        .prepare(
          `SELECT * FROM entries WHERE title LIKE ? OR body LIKE ?
           ORDER BY date DESC, created_at DESC LIMIT ?`,
        )
        .all(q, q, Math.min(limit ?? 20, 100)) as EntryRow[];
      return text({ total: rows.length, entries: rows });
    },
  );

  server.registerTool(
    "get_entry",
    {
      title: "获取装修记录详情",
      description: "按 id 获取一条装修记录",
      inputSchema: { id: z.string().describe("记录 id") },
    },
    ({ id }) => {
      const row = getEntry(id);
      return row ? text(row) : toolError(`记录不存在: ${id}`);
    },
  );

  server.registerTool(
    "create_entry",
    {
      title: "新增装修记录",
      description: "创建一条装修记录，date 不传默认今天",
      inputSchema: {
        title: z.string().describe("标题"),
        body: z.string().describe("正文内容").optional(),
        stage: z.string().describe("阶段：准备/拆改/水电/泥木/油漆/安装/入住").optional(),
        date: z.string().describe("日期 YYYY-MM-DD，默认今天").optional(),
      },
    },
    ({ title, body, stage, date }) => {
      const cleanTitle = title.trim().slice(0, 200);
      if (!cleanTitle) return toolError("title 不能为空");
      const row: EntryRow = {
        id: `entry-${Date.now()}-${randomUUID().slice(0, 8)}`,
        title: cleanTitle,
        body: (body ?? "").trim().slice(0, 20000),
        stage: (stage ?? "").trim().slice(0, 20) || "准备",
        date: (date ?? "").trim() || today(),
        created_at: now(),
        updated_at: now(),
      };
      db.prepare(
        `INSERT INTO entries (id, title, body, stage, date, created_at, updated_at)
         VALUES (@id, @title, @body, @stage, @date, @created_at, @updated_at)`,
      ).run(row);
      return text(row);
    },
  );

  server.registerTool(
    "list_links",
    {
      title: "查询收藏链接",
      description:
        "列出已保存的第三方链接（小红书文章等）。status=pending 即待 Agent 处理的任务队列",
      inputSchema: {
        status: z
          .enum(["pending", "processing", "done", "failed"])
          .describe("按状态筛选，不传则返回全部")
          .optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    ({ status, limit }) => {
      const rows = (
        status
          ? db
              .prepare(
                `SELECT * FROM links WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
              )
              .all(status, Math.min(limit ?? 50, 200))
          : db
              .prepare(`SELECT * FROM links ORDER BY created_at DESC LIMIT ?`)
              .all(Math.min(limit ?? 50, 200))
      ) as LinkRow[];
      return text({ total: rows.length, links: rows });
    },
  );

  server.registerTool(
    "get_link",
    {
      title: "获取链接详情",
      description: "按 id 获取一条链接的抓取结果",
      inputSchema: { id: z.string().describe("链接 id") },
    },
    ({ id }) => {
      const row = getLink(id);
      return row ? text(row) : toolError(`链接不存在: ${id}`);
    },
  );

  server.registerTool(
    "save_link",
    {
      title: "保存链接",
      description: "保存一个 http(s) 链接等待处理；重复 URL 会去重",
      inputSchema: { url: z.string().describe("完整的 http(s) 链接") },
    },
    ({ url }) => {
      let hostname = "";
      try {
        const parsed = new URL(url.trim());
        hostname = parsed.hostname;
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
      } catch {
        return toolError("url 必须是合法的 http(s) 链接");
      }
      const cleanUrl = url.trim().slice(0, 2000);
      const existing = db
        .prepare(`SELECT * FROM links WHERE url = ?`)
        .get(cleanUrl) as LinkRow | undefined;
      if (existing && existing.status !== "failed") {
        return text({ ...existing, deduplicated: true });
      }
      const ts = now();
      const row: LinkRow = {
        id: `link-${Date.now()}-${randomUUID().slice(0, 8)}`,
        url: cleanUrl,
        title: null,
        summary: null,
        content: null,
        cover_url: null,
        source: hostname,
        status: "pending",
        error: null,
        created_at: ts,
        updated_at: ts,
      };
      db.prepare(
        `INSERT INTO links (id, url, title, summary, content, cover_url, source,
         status, error, created_at, updated_at)
         VALUES (@id, @url, @title, @summary, @content, @cover_url, @source,
         @status, @error, @created_at, @updated_at)`,
      ).run(row);
      return text(row);
    },
  );

  server.registerTool(
    "update_link",
    {
      title: "写回链接处理结果",
      description:
        "Agent 抓取/总结链接后用此工具写回。典型流程：status 改 processing → 写入 title/summary/content/cover_url → status 改 done；失败时 status=failed 并写 error",
      inputSchema: {
        id: z.string().describe("链接 id"),
        title: z.string().optional(),
        summary: z.string().describe("内容摘要，展示用").optional(),
        content: z.string().describe("抓取到的正文全文").optional(),
        cover_url: z.string().describe("封面图 URL").optional(),
        status: z.enum(["pending", "processing", "done", "failed"]).optional(),
        error: z.string().describe("失败原因，status=failed 时填写").optional(),
      },
    },
    ({ id, ...patch }) => {
      const row = getLink(id);
      if (!row) return toolError(`链接不存在: ${id}`);
      const cleanStr = (v: string | undefined, max: number) =>
        v !== undefined ? v.trim().slice(0, max) || null : undefined;
      const next: LinkRow = {
        ...row,
        title: cleanStr(patch.title, 500) ?? row.title,
        summary: cleanStr(patch.summary, 2000) ?? row.summary,
        content: cleanStr(patch.content, 200000) ?? row.content,
        cover_url: cleanStr(patch.cover_url, 2000) ?? row.cover_url,
        status: patch.status ?? row.status,
        error: cleanStr(patch.error, 2000) ?? row.error,
        updated_at: now(),
      };
      db.prepare(
        `UPDATE links SET title = @title, summary = @summary, content = @content,
         cover_url = @cover_url, status = @status, error = @error, updated_at = @updated_at
         WHERE id = @id`,
      ).run(next);
      return text(next);
    },
  );

  return server;
}

export const mcpApp = new Hono();

mcpApp.all("/", async (c) => {
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const cleanup = () => {
    void transport.close();
    void server.close();
  };
  c.req.raw.signal.addEventListener("abort", cleanup);
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(c.req.raw);
    // 无状态模式下 JSON 响应已完整生成，可立即回收；SSE（如启用）靠 abort 清理。
    if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
      cleanup();
    }
    return response;
  } catch {
    cleanup();
    return c.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Invalid request" },
      },
      400,
    );
  }
});
