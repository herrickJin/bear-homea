import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { db, now } from "../db/index.js";
import type { CategoryRow } from "../db/schema.js";

export const categories = new Hono();

const clean = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const listSorted = (): CategoryRow[] =>
  db
    .prepare(`SELECT * FROM categories ORDER BY sort, created_at`)
    .all() as CategoryRow[];

categories.get("/", (c) => c.json({ categories: listSorted() }));

categories.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = clean(body.name, 20);
  if (!name) return c.json({ error: "分类名不能为空" }, 400);
  const dup = db.prepare(`SELECT id FROM categories WHERE name = ?`).get(name);
  if (dup) return c.json({ error: "分类已存在" }, 409);
  const count = (db.prepare(`SELECT count(*) AS n FROM categories`).get() as { n: number }).n;
  const row: CategoryRow = {
    id: `cat-${Date.now()}-${randomUUID().slice(0, 6)}`,
    name,
    sort: count,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO categories (id, name, sort, created_at)
     VALUES (@id, @name, @sort, @created_at)`,
  ).run(row);
  return c.json(row, 201);
});

categories.patch("/:id", async (c) => {
  const row = db
    .prepare(`SELECT * FROM categories WHERE id = ?`)
    .get(c.req.param("id")) as CategoryRow | undefined;
  if (!row) return c.json({ error: "分类不存在" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const name = body.name !== undefined ? clean(body.name, 20) : row.name;
  if (!name) return c.json({ error: "分类名不能为空" }, 400);
  const dup = db
    .prepare(`SELECT id FROM categories WHERE name = ? AND id != ?`)
    .get(name, row.id);
  if (dup) return c.json({ error: "分类已存在" }, 409);
  db.prepare(`UPDATE categories SET name = ? WHERE id = ?`).run(name, row.id);
  return c.json({ ...row, name });
});

categories.post("/:id/update", async (c) => {
  const row = db
    .prepare(`SELECT * FROM categories WHERE id = ?`)
    .get(c.req.param("id")) as CategoryRow | undefined;
  if (!row) return c.json({ error: "分类不存在" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const name = body.name !== undefined ? clean(body.name, 20) : row.name;
  if (!name) return c.json({ error: "分类名不能为空" }, 400);
  const dup = db
    .prepare(`SELECT id FROM categories WHERE name = ? AND id != ?`)
    .get(name, row.id);
  if (dup) return c.json({ error: "分类已存在" }, 409);
  db.prepare(`UPDATE categories SET name = ? WHERE id = ?`).run(name, row.id);
  return c.json({ ...row, name });
});

/** 上移/下移：dir = -1 | 1，返回重排后的完整列表 */
categories.post("/:id/move", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const dir = body.dir === 1 ? 1 : body.dir === -1 ? -1 : 0;
  if (!dir) return c.json({ error: "dir 必须是 1 或 -1" }, 400);
  const rows = db
    .prepare(`SELECT id FROM categories ORDER BY sort, created_at`)
    .all() as { id: string }[];
  const index = rows.findIndex((r) => r.id === id);
  const target = index + dir;
  if (index < 0 || target < 0 || target >= rows.length) {
    return c.json({ error: "已经在边界，无法移动" }, 400);
  }
  const swap = db.transaction(() => {
    const tmp = rows[index];
    rows[index] = rows[target];
    rows[target] = tmp;
    const update = db.prepare(`UPDATE categories SET sort = ? WHERE id = ?`);
    rows.forEach((r, i) => update.run(i, r.id));
  });
  swap();
  return c.json({ categories: listSorted() });
});

/** 删除分类：方案本身保留，仅从 category_ids 中剥离该分类 */
categories.delete("/:id", (c) => {
  const id = c.req.param("id");
  const row = db
    .prepare(`SELECT id FROM categories WHERE id = ?`)
    .get(id) as CategoryRow | undefined;
  if (!row) return c.json({ error: "分类不存在" }, 404);
  const wipe = db.transaction(() => {
    db.prepare(`DELETE FROM categories WHERE id = ?`).run(id);
    const links = db
      .prepare(`SELECT id, category_ids FROM links WHERE category_ids IS NOT NULL`)
      .all() as { id: string; category_ids: string }[];
    const update = db.prepare(`UPDATE links SET category_ids = ? WHERE id = ?`);
    for (const item of links) {
      try {
        const ids: string[] = JSON.parse(item.category_ids ?? "[]");
        if (ids.includes(id)) {
          update.run(JSON.stringify(ids.filter((v) => v !== id)), item.id);
        }
      } catch {
        /* 忽略坏数据 */
      }
    }
  });
  wipe();
  return c.json({ ok: true });
});
