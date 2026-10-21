// 装修准备数据（preparation_state 单行 JSON）的唯一读写口：HTTP 路由与 AI 工具共用。
//
// 应用侧才是这份数据的编辑者（PUT 带 revision 做乐观锁）；AI 写入走
// mutatePreparationState 之类的原子读改写并递增 revision。递增之后客户端手里的
// revision 会过期，下次 PUT 拿到 409 就会重新加载——所以聊天响应必须回传 changed，
// 让前端在 AI 改过数据后主动刷新，而不是等用户撞上冲突。

import { z } from "zod";
import { db, now } from "../db/index.js";

export const rooms = ["全屋", "客厅", "餐厅", "主卧", "次卧", "厨房", "卫生间", "阳台"] as const;
export type Room = (typeof rooms)[number];

const id = z.string().min(1).max(200);
const text = z.string().max(20000);
const url = z.string().max(2000).refine(v => /^https?:\/\//i.test(v) || /^\/files\//.test(v), "地址格式无效");
const item = z.object({ id, room: z.enum(rooms), name: z.string().trim().min(1).max(100), aliases: z.array(z.string().max(100)).max(50), fields: z.array(z.string().max(100)).max(50), questions: z.array(z.string().max(1000)).max(50) });
const record = z.object({
  id, room: z.enum(rooms), section: z.enum(["soft", "hard"]), category: z.string().max(100),
  name: z.string().trim().min(1).max(500), price: z.number().finite().nonnegative().nullable(), unit: z.string().max(30),
  pros: text, cons: text, note: text, status: z.enum(["saved", "shortlist", "bought"]), itemId: id.optional(),
  url: z.union([url, z.literal("")]).optional(), specs: z.record(z.string().max(100), z.string().max(2000)).optional(),
  images: z.array(url).max(9).optional(), analysis: text.optional(),
  analysisSources: z.array(z.object({ label: z.string().max(500), url })).max(50).optional(),
});

export const stateSchema = z.object({ records: z.array(record).max(5000), items: z.array(item).max(1000), skipped: z.array(id).max(1000), associations: z.record(z.string().max(250), z.array(id).max(1000)), appliedImports: z.array(id).max(100).optional() }).superRefine((state, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const items = new Map(state.items.map(i => [i.id, i]));
  if (items.size !== state.items.length || new Set(state.records.map(r => r.id)).size !== state.records.length) fail("ID 不可重复");
  if (state.skipped.some(i => !items.has(i))) fail("暂不需要的准备项不存在");
  const selected = new Set<string>();
  for (const r of state.records) {
    if (r.itemId && (items.has(r.itemId) && items.get(r.itemId)?.room !== r.room)) fail("候选与准备项的房间不一致");
    const inRoom = state.items.filter(i => i.room === r.room);
    const target = r.itemId ?? matchPreparationItem(inRoom, r.category, r.name)?.id;
    if (r.status === "shortlist" && target) { if (selected.has(target)) fail("同一准备项只能有一个已选定候选"); selected.add(target); }
  }
  for (const scope of Object.keys(state.associations)) {
    if (!(scope.startsWith("item:") && items.has(scope.slice(5))) && !(scope.startsWith("room:") && rooms.includes(scope.slice(5) as Room))) fail("笔记关联范围不存在");
  }
});

export type PreparationState = z.infer<typeof stateSchema>;
export type PreparationItem = PreparationState["items"][number];
export type PreparationRecord = PreparationState["records"][number];

export const emptyPreparationState = (): PreparationState => ({ records: [], items: [], skipped: [], associations: {} });

/**
 * 候选归属哪个准备项：先按品类别名精确命中，再按更长的别名做名称包含匹配
 * （与应用侧归类、stateSchema 校验用的是同一套规则，避免两边算出不同归属）。
 */
export function matchPreparationItem<T extends { id: string; aliases: string[] }>(
  inRoom: T[],
  category: string,
  name: string,
): T | undefined {
  return (
    inRoom.find(i => i.aliases.includes(category)) ??
    inRoom
      .flatMap(item => item.aliases.map(alias => ({ item, alias })))
      .filter(entry => name.includes(entry.alias))
      .sort((a, b) => b.alias.length - a.alias.length)[0]?.item
  );
}

export type PreparationRead = { revision: number; data: PreparationState | null; updatedAt: string | null };

export function readPreparationState(): PreparationRead {
  const row = db.prepare("SELECT revision, body, updated_at FROM preparation_state WHERE id = 1").get() as { revision: number; body: string; updated_at: string } | undefined;
  if (!row) return { revision: 0, data: null, updatedAt: null };
  return { revision: row.revision, data: JSON.parse(row.body) as PreparationState, updatedAt: row.updated_at };
}

export type PreparationWriteResult =
  | { ok: true; revision: number; data: PreparationState; updatedAt: string }
  | { ok: false; reason: "invalid"; details: string[] }
  | { ok: false; reason: "conflict" };

const persist = (revision: number, data: PreparationState) => {
  const updatedAt = now();
  db.prepare("INSERT INTO preparation_state(id, revision, body, updated_at) VALUES(1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, body=excluded.body, updated_at=excluded.updated_at").run(revision, JSON.stringify(data), updatedAt);
  return { ok: true as const, revision, data, updatedAt };
};

/** 条件写：仅当库中 revision 与 expected 相等时落库并 +1（应用侧 PUT 的乐观锁） */
export function writePreparationState(expected: number, data: PreparationState): PreparationWriteResult {
  const parsed = stateSchema.safeParse(data);
  if (!parsed.success) return { ok: false, reason: "invalid", details: parsed.error.issues.map(i => i.message) };
  const result: PreparationWriteResult = db.transaction(() => {
    const row = db.prepare("SELECT revision FROM preparation_state WHERE id = 1").get() as { revision: number } | undefined;
    if ((row?.revision ?? 0) !== expected) return { ok: false as const, reason: "conflict" as const };
    return persist(expected + 1, parsed.data);
  })();
  return result;
}

/**
 * 无条件读改写（AI 写入）。better-sqlite3 事务是同步的，Node 单线程下不会与其他
 * 请求交错，所以无需 CAS 重试；但 revision 必须继续递增，让客户端察觉数据变了。
 */
export function mutatePreparationState(fn: (state: PreparationState) => PreparationState): PreparationWriteResult {
  const result: PreparationWriteResult = db.transaction(() => {
    const current = readPreparationState();
    const parsed = stateSchema.safeParse(fn(current.data ?? emptyPreparationState()));
    if (!parsed.success) return { ok: false as const, reason: "invalid" as const, details: parsed.error.issues.map(i => i.message) };
    return persist(current.revision + 1, parsed.data);
  })();
  return result;
}
