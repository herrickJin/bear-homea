import { Hono } from "hono";
import fs from "node:fs";
import { config } from "../config.js";
import { db } from "../db/index.js";
import type { FileRow } from "../db/schema.js";
import { resolveWithin, saveUpload, toPublicFile } from "../services/files.js";

export const uploads = new Hono();

uploads.post("/", async (c) => {
  const body = await c.req.parseBody({ all: true });
  const parts = Object.values(body).flatMap((v) => (Array.isArray(v) ? v : [v]));
  const files = parts.filter((p): p is File => p instanceof File);
  if (!files.length) {
    return c.json(
      { error: "没有收到文件，请用 multipart/form-data，字段名任意" },
      400,
    );
  }
  const saved = [];
  for (const file of files) {
    saved.push(toPublicFile(await saveUpload(file)));
  }
  return c.json({ files: saved }, 201);
});

/** 文件读取路由：挂载在 /files 下，免鉴权（UUID 不可枚举即为凭证）。 */
export const files = new Hono();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

files.get("/:name", (c) => {
  const id = c.req.param("name").split(".")[0];
  if (!UUID_RE.test(id)) return c.json({ error: "文件不存在" }, 404);
  const row = db.prepare(`SELECT * FROM files WHERE id = ?`).get(id) as
    | FileRow
    | undefined;
  if (!row) return c.json({ error: "文件不存在" }, 404);
  let filepath: string;
  try {
    filepath = resolveWithin(config.filesDir, row.id + row.ext);
  } catch {
    return c.json({ error: "文件不存在" }, 404);
  }
  if (!fs.existsSync(filepath)) return c.json({ error: "文件不存在" }, 404);
  return c.body(fs.readFileSync(filepath), 200, {
    "Content-Type": row.mime_type,
    "Content-Length": String(row.size),
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
  });
});
