import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { db, now } from "../db/index.js";
import type { FileRow } from "../db/schema.js";

/**
 * 把相对片段解析到 root 之内，越界（../ 等）直接抛错。
 * 所有磁盘路径必须经过这里，保证读写不会逃出数据目录。
 */
export function resolveWithin(root: string, relative: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("路径越界");
  }
  return target;
}

/** 落盘并登记一条文件元数据，返回可公开访问的相对 URL。 */
export async function saveUpload(file: File): Promise<FileRow> {
  if (file.size > config.maxUploadBytes) {
    throw new Error(`文件 ${file.name} 超过 50MB 限制`);
  }
  const id = randomUUID();
  const ext = safeExt(file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.promises.writeFile(resolveWithin(config.filesDir, id + ext), buffer);
  const row: FileRow = {
    id,
    filename: file.name.slice(0, 255) || id,
    ext,
    mime_type: file.type || "application/octet-stream",
    size: buffer.byteLength,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO files (id, filename, ext, mime_type, size, created_at)
     VALUES (@id, @filename, @ext, @mime_type, @size, @created_at)`,
  ).run(row);
  return row;
}

/** 把已下载的字节流转存为自有文件（封面转存等场景），返回文件元数据 */
export async function saveBuffer(
  buffer: Buffer,
  ext: string,
  mime_type: string,
): Promise<FileRow> {
  const id = randomUUID();
  // 扩展名白名单：来源可能是远程页面的 content-type，不保证干净
  const safe = safeExt(`f${ext}`);
  const row: FileRow = {
    id,
    filename: id,
    ext: safe,
    mime_type,
    size: buffer.byteLength,
    created_at: now(),
  };
  fs.writeFileSync(resolveWithin(config.filesDir, id + ext), buffer);
  db.prepare(
    `INSERT INTO files (id, filename, ext, mime_type, size, created_at)
     VALUES (@id, @filename, @ext, @mime_type, @size, @created_at)`,
  ).run(row);
  return row;
}

function safeExt(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,11}$/.test(ext) ? ext : "";
}

/** 对外暴露的字段：id 不可枚举即天然鉴权（capability URL）。 */
export function toPublicFile(row: FileRow) {
  return {
    id: row.id,
    url: `/files/${row.id}${row.ext}`,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
  };
}
