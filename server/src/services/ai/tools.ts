// AI 助手（/api/chat）的内部工具：与 MCP 工具同源同界（同一 SQLite、同样裁剪），
// 但这里是进程内直调，不走 HTTP。
//
// v1 工具面 = 应用侧真实可见的两块数据：装修准备（preparation_state，候选/准备项）
// + 笔记库（links）。旧的 entries（装修记录）表应用侧从不写入也不展示，留在 MCP 给
// Hermes 用，但不再放进聊天工具面——否则模型会拿一张空表当“他家的现状”。
// 链接写回仍归 Hermes（队列语义在它那边），这里只读。
//
// 唯一的写工具是 add_candidate：屋主说“帮我记下来”时把确认过的商品落成候选，
// 走 preparation-state 的原子读改写并递增 revision，前端据此刷新。

import { randomUUID } from "node:crypto";
import { db } from "../../db/index.js";
import type { LinkRow } from "../../db/schema.js";
import {
  emptyPreparationState,
  matchPreparationItem,
  mutatePreparationState,
  readPreparationState,
  rooms,
  type PreparationItem,
  type PreparationRecord,
  type PreparationState,
  type Room,
} from "../preparation-state.js";
import type { ProviderToolSchema } from "./provider.js";
import { ANALYSIS_MAX_CHARS } from "./candidate-analysis.js";

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

const slice = (value: string | undefined, max: number): string => (value ?? "").slice(0, max);

/** 结构化错误返回给模型，不做字符串拼接 */
const fail = (code: string, detail?: unknown) => ({ error: code, detail: detail ?? null });

const asRoom = (value: unknown): Room | undefined => {
  const room = asString(value, 20);
  return rooms.includes(room as Room) ? (room as Room) : undefined;
};

// ---------- 装修准备 ----------

/** 列表里只给辨认和比较要用的字段，全文走 get_candidate */
const compactCandidate = (r: PreparationRecord) => ({
  id: r.id,
  room: r.room,
  name: r.name,
  price: r.price,
  unit: r.unit,
  category: r.category,
  section: r.section === "hard" ? "硬装" : "软装",
  status: r.status,
  itemId: r.itemId ?? null,
  url: r.url ?? null,
});

const loadState = (): PreparationState => readPreparationState().data ?? emptyPreparationState();

const nameOfItem = (state: PreparationState, itemId: string | undefined): string | null =>
  itemId ? state.items.find(i => i.id === itemId)?.name ?? null : null;

function listRoomPreparation(args: Record<string, unknown>): unknown {
  const room = asRoom(args.room);
  if (!room) return fail("bad_room", args.room ?? null);
  const state = loadState();
  const items = state.items.filter(i => i.room === room).map(item => {
    const candidates = state.records.filter(r => r.itemId === item.id);
    return {
      id: item.id,
      name: item.name,
      aliases: item.aliases,
      fields: item.fields,
      questions: item.questions,
      skipped: state.skipped.includes(item.id),
      selected: candidates.find(r => r.status === "shortlist")?.name ?? null,
      candidates: candidates.map(compactCandidate),
      noteIds: state.associations[`item:${item.id}`] ?? [],
    };
  });
  return {
    room,
    items,
    unassigned: state.records.filter(r => r.room === room && !r.itemId).map(compactCandidate),
    roomNoteIds: state.associations[`room:${room}`] ?? [],
  };
}

function listCandidates(args: Record<string, unknown>): unknown {
  const room = args.room === undefined ? undefined : asRoom(args.room);
  if (args.room !== undefined && !room) return fail("bad_room", args.room);
  const status = asString(args.status, 20);
  if (status && !["saved", "shortlist", "bought"].includes(status)) return fail("bad_status", status);
  const itemName = asString(args.itemName, 100);
  const limit = asInt(args.limit, 20, 100);
  const state = loadState();
  const itemIds = itemName
    ? new Set(
        state.items
          .filter(i => (!room || i.room === room) && (i.name === itemName || i.aliases.includes(itemName) || i.name.includes(itemName)))
          .map(i => i.id),
      )
    : undefined;
  const rows = state.records
    .filter(r => (!room || r.room === room) && (!status || r.status === status))
    // 按准备项筛时，待归类候选（没有 itemId）不算命中，别混进“某个准备项下的候选”
    .filter(r => !itemIds || (r.itemId !== undefined && itemIds.has(r.itemId)))
    .map(compactCandidate);
  return { total: rows.length, candidates: rows.slice(0, limit) };
}

function searchCandidates(args: Record<string, unknown>): unknown {
  const keyword = cleanKeyword(args.keyword);
  if (!keyword) return { total: 0, candidates: [] };
  const limit = asInt(args.limit, 10, 50);
  const state = loadState();
  const hit = (r: PreparationRecord) =>
    [r.name, r.category, r.note, r.pros, r.cons, r.analysis ?? "", r.room, r.unit].some(v => v.includes(keyword)) ||
    Object.entries(r.specs ?? {}).some(([k, v]) => k.includes(keyword) || v.includes(keyword));
  const rows = state.records.filter(hit).map(r => ({
    ...compactCandidate(r),
    itemName: nameOfItem(state, r.itemId),
    note: slice(r.note, 300),
    pros: slice(r.pros, 300),
    cons: slice(r.cons, 300),
  }));
  return { total: rows.length, candidates: rows.slice(0, limit) };
}

function getCandidate(args: Record<string, unknown>): unknown {
  const id = asString(args.id, 200);
  if (!id) return fail("bad_request", args.id);
  const state = loadState();
  const row = state.records.find(r => r.id === id);
  if (!row) return fail("not_found", id);
  return {
    ...row,
    itemName: nameOfItem(state, row.itemId),
    noteIds: row.itemId ? state.associations[`item:${row.itemId}`] ?? [] : [],
  };
}

/**
 * 把讨论结论落成一条候选。房间必填（不在房间列表里就拒绝，不猜）；准备项按
 * 品类别名/名称包含自动归类，匹配不到就留空进“待归类”，由用户之后再认领。
 */
function addCandidate(args: Record<string, unknown>): unknown {
  const room = asRoom(args.room);
  if (!room) return fail("bad_room", args.room ?? null);
  const name = asString(args.name, 500);
  if (!name) return fail("bad_request", "name");

  const section = args.section === "hard" ? "hard" : "soft";
  const numberPrice = typeof args.price === "number" ? args.price : Number(args.price);
  const price = Number.isFinite(numberPrice) && numberPrice >= 0 ? numberPrice : null;
  const rawUrl = asString(args.url, 2000);
  const state = loadState();
  const inRoom = state.items.filter(i => i.room === room);
  const requestedItem = asString(args.itemName, 100);
  const item: PreparationItem | undefined = requestedItem
    ? inRoom.find(i => i.name === requestedItem) ??
      inRoom.find(i => i.aliases.includes(requestedItem)) ??
      inRoom.find(i => i.name.includes(requestedItem))
    : undefined;

  const candidate: PreparationRecord = {
    id: `candidate-${Date.now()}-${randomUUID().slice(0, 8)}`,
    room,
    section,
    category: asString(args.category, 100) ?? (section === "hard" ? "主材" : "其他"),
    name,
    price,
    unit: asString(args.unit, 30) ?? "件",
    pros: asString(args.pros, 20000) ?? "",
    cons: asString(args.cons, 20000) ?? "",
    note: asString(args.note, 20000) ?? "",
    status: "saved",
    ...(asString(args.analysis, ANALYSIS_MAX_CHARS) ? { analysis: asString(args.analysis, ANALYSIS_MAX_CHARS)! } : {}),
    ...(item ? { itemId: item.id } : {}),
    ...(rawUrl && /^https?:\/\//i.test(rawUrl) ? { url: rawUrl } : {}),
  };

  const result = mutatePreparationState(current => {
    // 自动归类避开用户标了「暂不需要」的准备项：新记的候选先留在待归类，由用户认领，
    // 不要悄悄塞进一个他刚说过不需要的项里。明确点名 itemName 时才无视这个标记。
    const assigned =
      item ??
      matchPreparationItem(
        current.items.filter(i => i.room === room && !current.skipped.includes(i.id)),
        candidate.category,
        candidate.name,
      );
    return {
      ...current,
      records: [{ ...candidate, ...(assigned ? { itemId: assigned.id } : {}) }, ...current.records],
    };
  });
  if (!result.ok) {
    return result.reason === "invalid" ? fail("invalid_state", result.details) : fail("write_conflict");
  }
  const assignedId = result.data.records.find(r => r.id === candidate.id)?.itemId;
  return {
    revision: result.revision,
    candidate: compactCandidate({ ...candidate, ...(assignedId ? { itemId: assignedId } : {}) }),
    itemName: nameOfItem(result.data, assignedId),
    hint: assignedId ? "已归入对应准备项" : "未匹配到准备项，进入待归类，需要用户确认归属",
  };
}

/**
 * 把分析结论写进已有候选。只替换 analysis，保留用户自己维护的 analysisSources——
 * 模型没有联网能力，来源链接不由它生成，也不该被它清掉。
 */
function saveCandidateAnalysis(args: Record<string, unknown>): unknown {
  const id = asString(args.id, 200);
  if (!id) return fail("bad_request", "id");
  const analysis = asString(args.analysis, ANALYSIS_MAX_CHARS);
  if (!analysis) return fail("bad_request", "analysis");
  const before = loadState().records.find(r => r.id === id);
  if (!before) return fail("not_found", id);
  const result = mutatePreparationState(current => ({
    ...current,
    records: current.records.map(r => (r.id === id ? { ...r, analysis } : r)),
  }));
  if (!result.ok) {
    return result.reason === "invalid" ? fail("invalid_state", result.details) : fail("write_conflict");
  }
  return { revision: result.revision, candidate: { ...compactCandidate({ ...before, analysis }), analysis } };
}

// ---------- 笔记库 ----------
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

type AiTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export const aiTools: AiTool[] = [
  {
    name: "list_room_preparation",
    description:
      "看某个房间的装修准备情况：有哪些准备项、每项的候选与已选定、暂不需要的项、还没归类的候选、以及关联的笔记 id。房间只能从固定列表里选。",
    parameters: {
      type: "object",
      properties: { room: { type: "string", description: "房间：全屋/客厅/餐厅/主卧/次卧/厨房/卫生间/阳台" } },
      required: ["room"],
    },
  },
  {
    name: "list_candidates",
    description:
      "列出选购候选（商品或门店方案）。可按房间、准备项名称、状态筛选。status：saved 已记录 / shortlist 已选定 / bought 已买。价格是屋主记下的报价，未知为 null。",
    parameters: {
      type: "object",
      properties: {
        room: { type: "string", description: "按房间筛选" },
        itemName: { type: "string", description: "按准备项名称筛选，如“中央空调”" },
        status: { type: "string", description: "saved/shortlist/bought" },
        limit: { type: "integer", description: "条数，默认 20" },
      },
    },
  },
  {
    name: "search_candidates",
    description: "按关键词搜候选的名称、品类、备注、优缺点、参数和原文（例如“中央空调”“马桶 坑距”）。",
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
    name: "get_candidate",
    description: "按 id 取一条候选的全部信息：报价、参数、优缺点、分析、图片、来源链接和关联笔记 id。",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "候选 id" } },
      required: ["id"],
    },
  },
  {
    name: "add_candidate",
    description:
      "把讨论中确认的商品信息写成一条候选（屋主说「帮我记下来」「把这个存进清单」时用）。room 和 name 必填；price 只填屋主明确说出的数字，没有就省略，不要编造价格、品牌或型号。itemName 传准备项名称可指定归属，不传则按品类自动归类，归不上会进待归类。",
    parameters: {
      type: "object",
      properties: {
        room: { type: "string", description: "房间：全屋/客厅/餐厅/主卧/次卧/厨房/卫生间/阳台" },
        name: { type: "string", description: "商品或方案名，简短" },
        price: { type: "number", description: "单价数字，未知省略" },
        unit: { type: "string", description: "价格单位，默认件" },
        category: { type: "string", description: "品类，如 沙发、中央空调" },
        section: { type: "string", description: "soft 家具家电软装（默认）/ hard 建材五金" },
        note: { type: "string", description: "尺寸、渠道、报价范围等事实" },
        pros: { type: "string", description: "屋主明确说出的优点" },
        cons: { type: "string", description: "屋主明确说出的顾虑" },
        itemName: { type: "string", description: "归属的准备项名称" },
        url: { type: "string", description: "商品链接" },
        analysis: { type: "string", description: "可选：已有结论时一并写入，用空行分段，第一段是摘要" },
      },
      required: ["room", "name"],
    },
  },
  {
    name: "save_candidate_analysis",
    description:
      "把一条选购分析写进已有候选（屋主让你分析某款商品、或让你把结论记到这条候选上时用）。只替换分析正文，不碰用户自己维护的来源链接；分析里不许编造型号、参数或来源链接，没核实的信息写明待核实。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "候选 id" },
        analysis: { type: "string", description: "分析正文，空行分段，第一段是 2~3 句结论摘要，≤4000 字" },
      },
      required: ["id", "analysis"],
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

/** 会改动应用侧数据的工具：聊天响应要据此告诉前端刷新，否则客户端 revision 过期 */
export const WRITE_TOOLS = new Set(["add_candidate", "save_candidate_analysis"]);

/** 工具返回里有 error 字段即为失败，失败不算改动 */
export const toolFailed = (result: unknown): boolean =>
  typeof result === "object" && result !== null && "error" in result;

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
      case "list_room_preparation":
        return listRoomPreparation(args);
      case "list_candidates":
        return listCandidates(args);
      case "search_candidates":
        return searchCandidates(args);
      case "get_candidate":
        return getCandidate(args);
      case "add_candidate":
        return addCandidate(args);
      case "save_candidate_analysis":
        return saveCandidateAnalysis(args);
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
