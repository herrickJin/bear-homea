import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { statements } from "./schema.js";

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.filesDir, { recursive: true });

export const db = new Database(path.join(config.dataDir, "bear-home.db"));
db.pragma("journal_mode = WAL");

// 幂等迁移：schema.ts 里的语句逐条执行，已存在则跳过。
const migrate = db.transaction(() => {
  for (const stmt of statements) db.prepare(stmt).run();
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
