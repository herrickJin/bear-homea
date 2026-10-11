// AI 助手（/api/chat）的内部工具：与 MCP 工具同源同界（同一 SQLite、同样裁剪），
// 但这里是进程内直调，不走 HTTP。v1 以读为主 + create_entry（把讨论结论落成记录）；
// 链接写回仍归 Hermes（队列语义在它那边）。

import { randomUUID } from "node:crypto";
import { db, now, today } from "../../db/index.js";
import type { EntryRow, LinkRow } from "../../db/schema.js";
import type { ProviderToolSchema } from "./provider.js";

const asString = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

const asInt = (value: unknown, fallback: number, max: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
};

const cleanKeyword = (value: unknown): string =>
  typeof value === "string" ? value.replace(/[%_]/g, "").trim() : "";

const ENTRY_STAGES = ["准备", "拆改", "水电", "泥木", "油漆", "安装", "入住"];

/** 结构化错误返回给模型，不做字符串拼接 */
const fail = (code: string, id?: unknown) => ({ error: code, id: id ?? null });

type AiTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

function listEntries(args: Record<string, unknown>): unknown {
  const stage = asString(args.stage, 20);
  const limit = asInt(args.limit, 20, 100);
  const rows = (
    stage
      ? db
          .prepare(
            `SELECT * FROM entries WHERE stage = ? ORDER BY date DESC, created_at DESC LIMIT ?`,
          )
          .all(stage, limit)
      : db
          .prepare(
            `SELECT * FROM entries ORDER BY date DESC, created_at DESC LIMIT ?`,
          )
          .all(limit)
  ) as EntryRow[];
  return { total: rows.length, entries: rows };
}

function searchEntries(args: Record<string, unknown>): unknown {
  const keyword = cleanKeyword(args.keyword);
  if (!keyword) return { total: 0, entries: [] };
  const q = `%${keyword}%`;
  const rows = db
    .prepare(
      `SELECT * FROM entries WHERE title LIKE ? OR body LIKE ?
       ORDER BY date DESC, created_at DESC LIMIT ?`,
    )
    .all(q, q, asInt(args.limit, 10, 50)) as EntryRow[];
  return { total: rows.length, entries: rows };
}

function getEntry(args: Record<string, unknown>): unknown {
  const id = asString(args.id, 100);
  if (!id) return fail("bad_request", args.id);
  const row = db.prepare(`SELECT * FROM entries WHERE id = ?`).get(id) as
    | EntryRow
    | undefined;
  return row ?? fail("not_found", id);
}

function createEntry(args: Record<string, unknown>): unknown {
  const title = asString(args.title, 200);
  if (!title) return fail("bad_request");
  const stageRaw = asString(args.stage, 20) ?? "准备";
  const stage = ENTRY_STAGES.includes(stageRaw) ? stageRaw : "准备";
  const date = asString(args.date, 10) ?? "";
  const row: EntryRow = {
    id: ["entry-", Date.now(), "-", randomUUID().slice(0, 8)].join(""),
    title,
    body: asString(args.body, 20000) ?? "",
    stage,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today(),
    created_at: now(),
    updated_at: now(),
  };
  db.prepare(
    `INSERT INTO entries (id, title, body, stage, date, created_at, updated_at)
     VALUES (@id, @title, @body, @stage, @date, @created_at, @updated_at)`,
  ).run(row);
  return row;
}

function listLinks(args: Record<string, unknown>): unknown {
  const status = asString(args.status, 20);
  const limit = asInt(args.limit, 20, 100);
  const rows = (
    status
      ? db
          .prepare(
            `SELECT * FROM links WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
          )
          .all(status, limit)
      : db
          .prepare(`SELECT * FROM links ORDER BY created_at DESC LIMIT ?`)
          .all(limit)
  ) as LinkRow[];
  return { total: rows.length, links: rows };
}

function searchLinks(args: Record<string, unknown>): unknown {
  const keyword = cleanKeyword(args.keyword);
  if (!keyword) return { total: 0, links: [] };
  const q = `%${keyword}%`;
  const rows = db
    .prepare(
      `SELECT * FROM links WHERE title LIKE ? OR summary LIKE ? OR content LIKE ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(q, q, q, asInt(args.limit, 10, 50)) as LinkRow[];
  return { total: rows.length, links: rows };
}

function getLink(args: Record<string, unknown>): unknown {
  const id = asString(args.id, 100);
  if (!id) return fail("bad_request", args.id);
  const row = db.prepare(`SELECT * FROM links WHERE id = ?`).get(id) as
    | LinkRow
    | undefined;
  return row ?? fail("not_found", id);
}

export const aiTools: AiTool[] = [
  {
    name: "list_entries",
    description:
      "列出装修记录（时间倒序），可按阶段筛选。阶段：准备/拆改/水电/泥木/油漆/安装/入住",
    parameters: {
      type: "object",
      properties: {
        stage: { type: "string", description: "按阶段筛选" },
        limit: { type: "integer", description: "条数，默认 20" },
      },
    },
  },
  {
    name: "search_entries",
    description: "按关键词搜索装修记录的标题和正文",
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "关键词" },
        limit: { type: "integer", description: "条数，默认 10" },
      },
      required: ["keyword"],
    },
  },
  {
    name: "get_entry",
    description: "按 id 获取一条装修记录全文",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "记录 id" } },
      required: ["id"],
    },
  },
  {
    name: "create_entry",
    description:
      "把讨论中确认的事项写成一条装修记录（例如用户说「帮我把这个记下来」）。title 必填；stage 从七阶段里选",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "标题，一句话" },
        body: { type: "string", description: "正文要点" },
        stage: { type: "string", description: "阶段：准备/拆改/水电/泥木/油漆/安装/入住" },
        date: { type: "string", description: "日期 YYYY-MM-DD，默认今天" },
      },
      required: ["title"],
    },
  },
  {
    name: "list_links",
    description:
      "列出笔记库收藏的第三方内容（小红书文章等）。status：pending 待抓取 / processing 处理中 / done 已完成 / failed 失败",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "按状态筛选：pending/processing/done/failed",
        },
        limit: { type: "integer", description: "条数，默认 20" },
      },
    },
  },
  {
    name: "search_links",
    description: "按关键词搜索笔记库的标题、摘要和抓取正文",
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "关键词" },
        limit: { type: "integer", description: "条数，默认 10" },
      },
      required: ["keyword"],
    },
  },
  {
    name: "get_link",
    description: "按 id 获取一条笔记的完整内容（含抓取全文）",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "笔记 id" } },
      required: ["id"],
    },
  },
];

export const aiToolSchemas: ProviderToolSchema[] = aiTools.map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}));

/** 按工具名静态分发（模型产出的 arguments 是 JSON 文本，先解析再校验） */
export function runAiTool(name: string, rawArgs: string): unknown {
  let args: Record<string, unknown> = {};
  if (rawArgs) {
    try {
      args = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch {
      return fail("bad_json_args");
    }
  }
  try {
    switch (name) {
      case "list_entries":
        return listEntries(args);
      case "search_entries":
        return searchEntries(args);
      case "get_entry":
        return getEntry(args);
      case "create_entry":
        return createEntry(args);
      case "list_links":
        return listLinks(args);
      case "search_links":
        return searchLinks(args);
      case "get_link":
        return getLink(args);
      default:
        return fail("unknown_tool", name);
    }
  } catch {
    return fail("tool_failed", name);
  }
}
