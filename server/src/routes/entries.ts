import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { db, now, today } from "../db/index.js";
import type { EntryRow } from "../db/schema.js";

export const entries = new Hono();

const clean = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

entries.get("/", (c) => {
  const stage = c.req.query("stage");
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const rows = (
    stage
      ? db
          .prepare(
            `SELECT * FROM entries WHERE stage = ? ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`,
          )
          .all(stage, limit, offset)
      : db
          .prepare(
            `SELECT * FROM entries ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`,
          )
          .all(limit, offset)
  ) as EntryRow[];
  return c.json({ entries: rows });
});

entries.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const title = clean(body.title, 200);
  if (!title) return c.json({ error: "title 不能为空" }, 400);
  const row: EntryRow = {
    id: `entry-${Date.now()}-${randomUUID().slice(0, 8)}`,
    title,
    body: clean(body.body, 20000),
    stage: clean(body.stage, 20) || "准备",
    date: clean(body.date, 10) || today(),
    created_at: now(),
    updated_at: now(),
  };
  db.prepare(
    `INSERT INTO entries (id, title, body, stage, date, created_at, updated_at)
     VALUES (@id, @title, @body, @stage, @date, @created_at, @updated_at)`,
  ).run(row);
  return c.json(row, 201);
});

entries.get("/:id", (c) => {
  const row = db
    .prepare(`SELECT * FROM entries WHERE id = ?`)
    .get(c.req.param("id")) as EntryRow | undefined;
  if (!row) return c.json({ error: "记录不存在" }, 404);
  return c.json(row);
});

entries.put("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = db
    .prepare(`SELECT * FROM entries WHERE id = ?`)
    .get(id) as EntryRow | undefined;
  if (!existing) return c.json({ error: "记录不存在" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const next: EntryRow = {
    ...existing,
    title: clean(body.title, 200) || existing.title,
    body: typeof body.body === "string" ? clean(body.body, 20000) : existing.body,
    stage: clean(body.stage, 20) || existing.stage,
    date: clean(body.date, 10) || existing.date,
    updated_at: now(),
  };
  db.prepare(
    `UPDATE entries SET title = @title, body = @body, stage = @stage,
     date = @date, updated_at = @updated_at WHERE id = @id`,
  ).run(next);
  return c.json(next);
});

entries.delete("/:id", (c) => {
  const info = db.prepare(`DELETE FROM entries WHERE id = ?`).run(c.req.param("id"));
  if (!info.changes) return c.json({ error: "记录不存在" }, 404);
  return c.json({ ok: true });
});
