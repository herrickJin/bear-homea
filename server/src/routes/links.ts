import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { db, now } from "../db/index.js";
import type { LinkRow } from "../db/schema.js";

export const links = new Hono();

const STATUSES = ["pending", "processing", "done", "failed"] as const;
type Status = (typeof STATUSES)[number];

const isStatus = (v: unknown): v is Status =>
  typeof v === "string" && (STATUSES as readonly string[]).includes(v);

const clean = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const getById = (id: string): LinkRow | undefined =>
  db.prepare(`SELECT * FROM links WHERE id = ?`).get(id) as LinkRow | undefined;

/** 链接列表；?status=pending 就是 Agent 的任务队列。 */
links.get("/", (c) => {
  const status = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const rows = (
    isStatus(status)
      ? db
          .prepare(
            `SELECT * FROM links WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
          )
          .all(status, limit)
      : db.prepare(`SELECT * FROM links ORDER BY created_at DESC LIMIT ?`).all(limit)
  ) as LinkRow[];
  return c.json({ links: rows });
});

/**
 * 保存链接。同一 URL 只保留一条：
 * 已存在且未失败 → 原样返回（去重）；失败过的 → 重置为 pending 重试。
 */
links.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  let hostname = "";
  try {
    const parsed = new URL(clean(body.url, 2000));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    hostname = parsed.hostname;
  } catch {
    return c.json({ error: "url 必须是合法的 http(s) 链接" }, 400);
  }
  const url = clean(body.url, 2000);
  const ts = now();
  const existing = db
    .prepare(`SELECT * FROM links WHERE url = ?`)
    .get(url) as LinkRow | undefined;
  if (existing && existing.status !== "failed") {
    return c.json({ ...existing, deduplicated: true });
  }
  if (existing) {
    db.prepare(
      `UPDATE links SET status = 'pending', title = NULL, summary = NULL,
       content = NULL, cover_url = NULL, error = NULL, updated_at = ? WHERE id = ?`,
    ).run(ts, existing.id);
    return c.json({ ...getById(existing.id)!, reset: true });
  }
  const row: LinkRow = {
    id: `link-${Date.now()}-${randomUUID().slice(0, 8)}`,
    url,
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
  return c.json(row, 201);
});

links.get("/:id", (c) => {
  const row = getById(c.req.param("id"));
  if (!row) return c.json({ error: "链接不存在" }, 404);
  return c.json(row);
});

/** Agent 抓取/总结后的写回入口：字段全部可选，只更新传了的。 */
links.patch("/:id", async (c) => {
  const row = getById(c.req.param("id"));
  if (!row) return c.json({ error: "链接不存在" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (body.status !== undefined && !isStatus(body.status)) {
    return c.json({ error: `status 必须是 ${STATUSES.join("/")}` }, 400);
  }
  const next: LinkRow = {
    ...row,
    title: body.title !== undefined ? clean(body.title, 500) || null : row.title,
    summary:
      body.summary !== undefined ? clean(body.summary, 2000) || null : row.summary,
    content:
      body.content !== undefined ? clean(body.content, 200000) || null : row.content,
    cover_url:
      body.cover_url !== undefined
        ? clean(body.cover_url, 2000) || null
        : row.cover_url,
    status: isStatus(body.status) ? body.status : row.status,
    error: body.error !== undefined ? clean(body.error, 2000) || null : row.error,
    updated_at: now(),
  };
  db.prepare(
    `UPDATE links SET title = @title, summary = @summary, content = @content,
     cover_url = @cover_url, status = @status, error = @error, updated_at = @updated_at
     WHERE id = @id`,
  ).run(next);
  return c.json(next);
});

/** 手动重试：把失败或想重抓的链接重置为 pending。 */
links.post("/:id/reset", (c) => {
  const row = getById(c.req.param("id"));
  if (!row) return c.json({ error: "链接不存在" }, 404);
  db.prepare(
    `UPDATE links SET status = 'pending', error = NULL, updated_at = ? WHERE id = ?`,
  ).run(now(), row.id);
  return c.json(getById(row.id)!);
});

links.delete("/:id", (c) => {
  const info = db.prepare(`DELETE FROM links WHERE id = ?`).run(c.req.param("id"));
  if (!info.changes) return c.json({ error: "链接不存在" }, 404);
  return c.json({ ok: true });
});
