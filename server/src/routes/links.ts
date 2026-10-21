import { Hono } from "hono";
import type { Context } from "hono";
import { randomUUID } from "node:crypto";
import { db, now } from "../db/index.js";
import type { CategoryRow, LinkNoteRow, LinkRow } from "../db/schema.js";
import {
  friendlySource,
  queueCoverStore,
  queueScrape,
} from "../services/scrape.js";

export const links = new Hono();

const STATUSES = ["pending", "processing", "done", "failed"] as const;
type Status = (typeof STATUSES)[number];

const isStatus = (v: unknown): v is Status =>
  typeof v === "string" && (STATUSES as readonly string[]).includes(v);

const clean = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const getById = (id: string): LinkRow | undefined =>
  db.prepare(`SELECT * FROM links WHERE id = ?`).get(id) as
    | LinkRow
    | undefined;

/** 规范地址：去 query/hash —— 分享链接的 xsec_token 每次都不同，判重只看路径 */
const canonical = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return url;
  }
};

const knownCategoryIds = (): Set<string> => {
  const rows = db.prepare(`SELECT id FROM categories`).all() as {
    id: string;
  }[];
  return new Set(rows.map((r) => r.id));
};

const normalizeCategoryIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const known = knownCategoryIds();
  return [...new Set(value.filter((v): v is string => typeof v === "string" && known.has(v)))];
};

/** 链接列表；?tag=<分类id> & ?q=<关键词(备注/标题/摘要)> & ?status= */
links.get("/", (c) => {
  const tag = c.req.query("tag");
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const status = c.req.query("status");
  let rows = db
    .prepare(`SELECT * FROM links ORDER BY created_at DESC, id DESC`)
    .all() as LinkRow[];
  if (tag) rows = rows.filter((l) => (JSON.parse(l.category_ids ?? "[]") as string[]).includes(tag));
  if (q) {
    rows = rows.filter((l) =>
      [l.note, l.title, l.summary, l.source].some((field) =>
        (field ?? "").toLowerCase().includes(q),
      ),
    );
  }
  if (isStatus(status)) rows = rows.filter((l) => l.status === status);
  return c.json({ links: rows });
});

/**
 * 保存方案：链接型（url + 可选解析标题）或纯想法（url 为 null，note 即正文）。
 * 判重按规范地址（去 query）：同一篇不同 xsec_token 不会重复。
 */
links.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const url = clean(body.url, 2000) || null;
  const note = clean(body.note, 500) || null;
  const title = clean(body.title, 500) || null;
  const shotUrls = Array.isArray(body.shot_urls)
    ? body.shot_urls.map((value: unknown) => clean(value, 500)).filter(Boolean)
    : [];
  const shotUrl = shotUrls[0] || clean(body.shot_url, 500) || null;
  if (!shotUrls.length && shotUrl) shotUrls.push(shotUrl);
  const categoryIds = normalizeCategoryIds(body.category_ids);

  if (url) {
    let source = "";
    try {
      source = new URL(url).hostname;
    } catch {
      return c.json({ error: "url 必须是合法的 http(s) 链接" }, 400);
    }
    if (!/^https?:$/.test(new URL(url).protocol)) {
      return c.json({ error: "仅支持 http(s) 链接" }, 400);
    }
    const all = db.prepare(`SELECT * FROM links`).all() as LinkRow[];
    const existing = all.find((l) => l.url && canonical(l.url) === canonical(url));
    if (existing) {
      return c.json({ ...existing, deduplicated: true });
    }
    const row: LinkRow = {
      id: `link-${Date.now()}-${randomUUID().slice(0, 8)}`,
      url,
      title,
      summary: null,
      content: null,
      note,
      category_ids: JSON.stringify(categoryIds),
      shot_url: shotUrl,
      shot_urls: JSON.stringify(shotUrls),
      cover_url: null,
      source: friendlySource(source),
      status: "pending",
      error: null,
      created_at: now(),
      updated_at: now(),
    };
    db.prepare(
      `INSERT INTO links (id, url, title, summary, content, note, category_ids,
         shot_url, shot_urls, cover_url, source, status, error, created_at, updated_at)
       VALUES (@id, @url, @title, @summary, @content, @note, @category_ids,
         @shot_url, @shot_urls, @cover_url, @source, @status, @error, @created_at, @updated_at)`,
    ).run(row);
    queueScrape(row.id);
    return c.json(row, 201);
  }

  // 纯想法支持仅图片。
  if (!note && !shotUrls.length) return c.json({ error: "写点想法，或粘贴图片或链接" }, 400);
  const row: LinkRow = {
    id: `idea-${Date.now()}-${randomUUID().slice(0, 8)}`,
    url: null,
    title,
    summary: null,
    content: null,
    note,
    category_ids: JSON.stringify(categoryIds),
    shot_url: shotUrl,
    shot_urls: JSON.stringify(shotUrls),
    cover_url: null,
    source: "想法",
    status: "done",
    error: null,
    created_at: now(),
    updated_at: now(),
  };
  db.prepare(
    `INSERT INTO links (id, url, title, summary, content, note, category_ids,
       shot_url, shot_urls, cover_url, source, status, error, created_at, updated_at)
     VALUES (@id, @url, @title, @summary, @content, @note, @category_ids,
       @shot_url, @shot_urls, @cover_url, @source, @status, @error, @created_at, @updated_at)`,
  ).run(row);
  return c.json(row, 201);
});

const notesFor = (linkId: string): LinkNoteRow[] =>
  db
    .prepare(`SELECT * FROM link_notes WHERE link_id = ? ORDER BY created_at, id`)
    .all(linkId) as LinkNoteRow[];

links.get("/:id", (c) => {
  const row = getById(c.req.param("id"));
  if (!row) return c.json({ error: "方案不存在" }, 404);
  return c.json({ ...row, notes: notesFor(row.id) });
});

/** 写回入口：Agent 补摘要/封面，用户改备注/归类/截图，字段全部可选。
 *  同时提供 PATCH /:id 与 POST /:id/update（小程序 request 不支持 PATCH） */
async function updateHandler(c: Context) {
  const row = getById(c.req.param("id") ?? "");
  if (!row) return c.json({ error: "方案不存在" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (body.status !== undefined && !isStatus(body.status)) {
    return c.json({ error: `status 必须是 ${STATUSES.join("/")}` }, 400);
  }
  const categoryIds =
    body.category_ids !== undefined
      ? JSON.stringify(normalizeCategoryIds(body.category_ids))
      : row.category_ids;
  const next: LinkRow = {
    ...row,
    title: body.title !== undefined ? clean(body.title, 500) || null : row.title,
    summary:
      body.summary !== undefined ? clean(body.summary, 2000) || null : row.summary,
    content:
      body.content !== undefined ? clean(body.content, 200000) || null : row.content,
    note: body.note !== undefined ? clean(body.note, 500) || null : row.note,
    category_ids: categoryIds,
    shot_url:
      body.shot_url !== undefined
        ? clean(body.shot_url, 500) || null
        : row.shot_url,
    shot_urls: body.shot_url !== undefined
      ? JSON.stringify(body.shot_url ? [clean(body.shot_url, 500)] : [])
      : row.shot_urls ?? "[]",
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
     note = @note, category_ids = @category_ids, shot_url = @shot_url, shot_urls = @shot_urls,
     cover_url = @cover_url, status = @status, error = @error, updated_at = @updated_at
     WHERE id = @id`,
  ).run(next);
  // 外链封面异步转存：只传 id，worker 从库现读（请求输入不直达下载）
  if (next.cover_url) queueCoverStore(next.id);
  return c.json(next);
}
links.patch("/:id", updateHandler);
links.post("/:id/update", updateHandler);

/** 手动重试：把失败或想重抓的链接重置为 pending 并立即重新解析。 */
links.post("/:id/reset", (c) => {
  const row = getById(c.req.param("id"));
  if (!row) return c.json({ error: "方案不存在" }, 404);
  db.prepare(
    `UPDATE links SET status = 'pending', error = NULL, updated_at = ? WHERE id = ?`,
  ).run(now(), row.id);
  queueScrape(row.id);
  return c.json(getById(row.id)!);
});

/* ===== 方案备注（多条时间线） ===== */

links.get("/:id/notes", (c) => {
  const id = c.req.param("id");
  if (!getById(id)) return c.json({ error: "方案不存在" }, 404);
  return c.json({ notes: notesFor(id) });
});

links.post("/:id/notes", async (c) => {
  const id = c.req.param("id");
  if (!getById(id)) return c.json({ error: "方案不存在" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const text = clean(body.body, 1000);
  if (!text) return c.json({ error: "备注内容不能为空" }, 400);
  const note: LinkNoteRow = {
    id: `note-${Date.now()}-${randomUUID().slice(0, 6)}`,
    link_id: id,
    body: text,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO link_notes (id, link_id, body, created_at)
     VALUES (@id, @link_id, @body, @created_at)`,
  ).run(note);
  return c.json(note, 201);
});

links.delete("/:id/notes/:noteId", (c) => {
  const { id, noteId } = c.req.param();
  if (!getById(id)) return c.json({ error: "方案不存在" }, 404);
  const info = db
    .prepare(`DELETE FROM link_notes WHERE id = ? AND link_id = ?`)
    .run(noteId, id);
  if (!info.changes) return c.json({ error: "备注不存在" }, 404);
  return c.json({ ok: true });
});

links.delete("/:id", (c) => {
  const id = c.req.param("id");
  if (!getById(id)) return c.json({ error: "方案不存在" }, 404);
  db.prepare(`DELETE FROM link_notes WHERE link_id = ?`).run(id);
  db.prepare(`DELETE FROM links WHERE id = ?`).run(id);
  return c.json({ ok: true });
});
