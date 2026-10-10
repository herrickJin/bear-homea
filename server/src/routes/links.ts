import { Hono } from "hono";
import type { Context } from "hono";
import { randomUUID } from "node:crypto";
import { db, now } from "../db/index.js";
import type { CategoryRow, LinkNoteRow, LinkRow } from "../db/schema.js";
import { saveBuffer } from "../services/files.js";

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
  const shotUrl = clean(body.shot_url, 500) || null;
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
      cover_url: null,
      source,
      status: "pending",
      error: null,
      created_at: now(),
      updated_at: now(),
    };
    db.prepare(
      `INSERT INTO links (id, url, title, summary, content, note, category_ids,
         shot_url, cover_url, source, status, error, created_at, updated_at)
       VALUES (@id, @url, @title, @summary, @content, @note, @category_ids,
         @shot_url, @cover_url, @source, @status, @error, @created_at, @updated_at)`,
    ).run(row);
    void scrapeLink(row.id);
    return c.json(row, 201);
  }

  // 纯想法：必须有一句正文
  if (!note) return c.json({ error: "写点什么，或粘贴一个链接" }, 400);
  const row: LinkRow = {
    id: `idea-${Date.now()}-${randomUUID().slice(0, 8)}`,
    url: null,
    title,
    summary: null,
    content: null,
    note,
    category_ids: JSON.stringify(categoryIds),
    shot_url: shotUrl,
    cover_url: null,
    source: "想法",
    status: "done",
    error: null,
    created_at: now(),
    updated_at: now(),
  };
  db.prepare(
    `INSERT INTO links (id, url, title, summary, content, note, category_ids,
       shot_url, cover_url, source, status, error, created_at, updated_at)
     VALUES (@id, @url, @title, @summary, @content, @note, @category_ids,
       @shot_url, @cover_url, @source, @status, @error, @created_at, @updated_at)`,
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
     note = @note, category_ids = @category_ids, shot_url = @shot_url,
     cover_url = @cover_url, status = @status, error = @error, updated_at = @updated_at
     WHERE id = @id`,
  ).run(next);
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
  void scrapeLink(row.id);
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

/* ===== 小红书/网页 OG 信息解析（保存后异步执行，不阻塞响应） ===== */

async function scrapeLink(id: string): Promise<void> {
  const row = getById(id);
  if (!row?.url) return;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(row.url, {
      headers: {
        // 小红书对爬虫 UA 返回验证页，用移动端 Safari UA 可拿到 SSR 的 og 元信息
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const html = await res.text();
    console.log(
      `[scrape-fetch] final=${res.url} status=${res.status} ct=${res.headers.get("content-type")}`,
    );
    const meta = (prop: string): string | null => {
      const patterns = [
        new RegExp(
          `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`,
          "i",
        ),
        new RegExp(
          `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`,
          "i",
        ),
      ];
      for (const pattern of patterns) {
        const m = html.match(pattern);
        if (m?.[1]) return m[1].trim();
      }
      return null;
    };
    const ogTitle = meta("og:title");
    const ogImage = meta("og:image");
    const ogDesc = meta("og:description");

    // 小红书对无 cookie 请求返回空壳 og（标题「- 小红书」、占位图），
    // 真实标题/封面在页面数据里 —— 逐级降级提取
    const ogTitleUsable =
      ogTitle && !/^(\s*-\s*)?小红书$/.test(ogTitle.trim()) ? clean(ogTitle, 500) : null;
    const jsonTitle = html.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/i)?.[1];
    let jsonTitleClean: string | null = null;
    if (jsonTitle && jsonTitle.length >= 2) {
      try {
        jsonTitleClean = clean(JSON.parse(`"${jsonTitle}"`) as string, 500) || null;
      } catch {
        jsonTitleClean = null;
      }
    }
    const ogImageUsable =
      ogImage && !ogImage.includes("ci.xiaohongshu.com/?") ? clean(ogImage, 1000) : null;
    const webpic =
      html.match(/https?:\/\/sns-webpic-qc\.xhscdn\.com[^"'\\\s]+/i)?.[0] ?? null;
    const remoteCover = ogImageUsable ?? webpic;

    // 封面转存：下载到自有 /files/，避免外链防盗链导致无法显示
    let coverStored: string | null = null;
    if (remoteCover) {
      try {
        const imgRes = await fetch(remoteCover, {
          headers: {
            Referer: "https://www.xiaohongshu.com/",
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          },
        });
        if (imgRes.ok) {
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          if (buffer.byteLength > 1024) {
            const type = imgRes.headers.get("content-type") ?? "image/jpeg";
            const ext =
              type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : ".jpg";
            const file = await saveBuffer(buffer, ext, type.split(";")[0]);
            coverStored = `/files/${file.id}${file.ext}`;
          }
        }
      } catch {
        /* 转存失败则保留远程地址 */
      }
    }
    const cover = coverStored ?? remoteCover;

    db.prepare(
      `UPDATE links SET
         title = ?, summary = ?, cover_url = ?,
         status = 'done', error = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(
      (row.title ?? ogTitleUsable ?? jsonTitleClean) || null,
      clean(ogDesc, 500) || null,
      cover,
      now(),
      id,
    );
  } catch (err) {
    db.prepare(
      `UPDATE links SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
    ).run(String(err).slice(0, 200), now(), id);
  }
}

links.delete("/:id", (c) => {
  const info = db.prepare(`DELETE FROM links WHERE id = ?`).run(c.req.param("id"));
  if (!info.changes) return c.json({ error: "方案不存在" }, 404);
  return c.json({ ok: true });
});
