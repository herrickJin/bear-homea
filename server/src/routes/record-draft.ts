import { Hono } from "hono";
import { z } from "zod";
import { config } from "../config.js";
import { createRecordDraft, rooms } from "../services/ai/record-draft.js";
import { ProviderError } from "../services/ai/provider.js";

export const recordDraft = new Hono();
const inputSchema = z.object({ text: z.string().trim().min(1).max(2000), room: z.enum(rooms).optional() });
recordDraft.get("/", (c) => c.json({ available: Boolean(config.ai.apiKey) }));
recordDraft.post("/", async (c) => {
  const input = inputSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "写一段选购信息（最多 2000 字）" }, 400);
  try {
    const draft = await createRecordDraft(input.data.text, input.data.room, c.req.raw.signal);
    return c.json({ draft });
  } catch (error) {
    if (error instanceof ProviderError) {
      return c.json({ error: error.status === 503 ? error.message : "AI 整理失败，请重试或直接保存原文" }, error.status === 503 ? 503 : 502);
    }
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      return c.json({ error: "AI 整理超时，请重试或直接保存原文" }, 504);
    }
    return c.json({ error: "暂时连接不上 AI，可以直接保存原文" }, 502);
  }
});
