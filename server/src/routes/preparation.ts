import { Hono } from "hono";
import { z } from "zod";
import { readPreparationState, rooms, stateSchema, writePreparationState } from "../services/preparation-state.js";

export const preparation = new Hono();
preparation.get("/", c => c.json(readPreparationState()));
preparation.put("/", async c => {
  const input = z.object({ revision: z.number().int().nonnegative(), data: stateSchema }).safeParse(await c.req.json());
  if (!input.success) {
    // revision 本身不合法时没有 data 的 issues 可给，保持原契约返回空 details。
    const revisionIssue = input.error.issues.some(i => i.path[0] === "revision");
    return c.json({ error: "选购数据无效", details: revisionIssue ? [] : input.error.issues.map(i => i.message) }, 400);
  }
  const result = writePreparationState(input.data.revision, input.data.data);
  if (result.ok) return c.json({ revision: result.revision, data: result.data, updatedAt: result.updatedAt });
  return result.reason === "conflict"
    ? c.json({ error: "其他设备已修改，请重新加载后再编辑" }, 409)
    : c.json({ error: "选购数据无效", details: result.details }, 400);
});

export const roomDirectory = new Hono();
roomDirectory.get("/", c => c.json({ rooms: rooms.map((name, sort) => ({ id: name, name, sort, noteCategoryNames: name === "主卧" || name === "次卧" ? [name, "卧室"] : [name] })) }));
