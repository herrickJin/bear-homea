import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { statements, LINKS_DDL } from "./schema.js";

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.filesDir, { recursive: true });

export const db = new Database(path.join(config.dataDir, "bear-home.db"));
db.pragma("journal_mode = WAL");

type PragmaColumn = { name: string; notnull: number };

// 幂等迁移：schema.ts 里的语句逐条执行，已存在则跳过。
// 特殊处理：旧版 links.url 是 NOT NULL，而纯想法方案没有 url ——
// 检测到旧结构时重建表并保留旧数据（一次性行，之后不再触发）。
const migrate = db.transaction(() => {
  for (const stmt of statements) db.prepare(stmt).run();
  const cols = db.prepare(`pragma table_info(links)`).all() as PragmaColumn[];
  const urlCol = cols.find((c) => c.name === "url");
  if (cols.length && urlCol?.notnull) {
    db.prepare(`DROP INDEX IF EXISTS links_url_idx`).run();
    db.prepare(`DROP INDEX IF EXISTS links_status_idx`).run();
    db.prepare(`ALTER TABLE links RENAME TO links_legacy`).run();
    db.prepare(LINKS_DDL).run();
    db.prepare(
      `INSERT INTO links (id, url, title, summary, content, cover_url, source,
         status, error, created_at, updated_at, note, category_ids, shot_url)
       SELECT id, url, title, summary, content, cover_url, source,
         status, error, created_at, updated_at, NULL, '[]', NULL
       FROM links_legacy`,
    ).run();
    db.prepare(`DROP TABLE links_legacy`).run();
  }
});
migrate();

export const now = () => new Date().toISOString();

/** 与前端 Entry.date 的 YYYY-MM-DD 格式保持一致 */
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};
