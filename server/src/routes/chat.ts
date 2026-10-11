// AI 助手路由：
// - POST /api/chat        同步一轮对话（小程序用，Taro.request 无流式）
// - POST /api/chat/stream SSE 流式（H5 用），事件：meta / delta / tool / done / error
// - 会话管理：GET /api/chat/sessions、GET /api/chat/sessions/:id、DELETE

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { db, now } from "../db/index.js";
import type { ChatMessageRow, ChatSessionRow } from "../db/schema.js";
import { AiUnavailableError, runChat, type ChatContext } from "../services/ai/agent.js";
import { ProviderError } from "../services/ai/provider.js";

type ChatBody = {
  sessionId?: unknown;
  message?: unknown;
  context?: unknown;
};

/** 手工校验请求体，返回 null 表示不合法 */
function parseBody(body: ChatBody):
  | { ok: true; sessionId?: string; message: string; context?: ChatContext }
  | { ok: false } {
  if (typeof body.message !== "string" || !body.message.trim()) return { ok: false };
  if (body.message.length > 8000) return { ok: false };
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : undefined;
  let context: ChatContext | undefined;
  if (body.context && typeof body.context === "object" && !Array.isArray(body.context)) {
    const raw = body.context as ChatContext;
    context = {};
    if (typeof raw.page === "string") context.page = raw.page.slice(0, 100);
    if (raw.ref !== undefined) context.ref = raw.ref;
  }
  return { ok: true, sessionId, message: body.message, context };
}

export const chat = new Hono();

chat.post("/", async (c) => {
  const parsed = parseBody(await c.req.json<ChatBody>().catch(() => ({}) as ChatBody));
  if (!parsed.ok) return c.json({ error: "message 必填（≤8000 字）" }, 400);
  try {
    const result = await runChat({
      sessionId: parsed.sessionId,
      message: parsed.message,
      context: parsed.context,
      signal: c.req.raw.signal,
    });
    return c.json(result);
  } catch (err) {
    // 客户端取消（499 非标准码，Hono 类型不收）：给个空响应即可，别进 onError 刷日志
    if (c.req.raw.signal.aborted) return new Response(null, { status: 499 });
    if (err instanceof AiUnavailableError) return c.json({ error: err.message }, 503);
    if (err instanceof ProviderError) return c.json({ error: err.message }, 502);
    throw err;
  }
});

chat.post("/stream", (c) => {
  return streamSSE(c, async (sse) => {
    const body = (await c.req.json<ChatBody>().catch(() => ({}) as ChatBody)) as ChatBody;
    const parsed = parseBody(body);
    if (!parsed.ok) {
      await sse.writeSSE({ event: "error", data: JSON.stringify({ message: "message 必填（≤8000 字）" }) });
      return;
    }
    let sessionId = parsed.sessionId ?? "";
    try {
      const result = await runChat({
        sessionId: parsed.sessionId,
        message: parsed.message,
        context: parsed.context,
        signal: c.req.raw.signal,
        onEvent: (event) => {
          if (event.type === "tool_start") {
            void sse.writeSSE({ event: "tool", data: JSON.stringify({ name: event.name }) });
          } else if (event.type === "text_delta" && event.text) {
            void sse.writeSSE({ event: "delta", data: JSON.stringify({ text: event.text }) });
          }
        },
      });
      sessionId = result.sessionId;
      await sse.writeSSE({
        event: "done",
        data: JSON.stringify({ sessionId: result.sessionId, reply: result.reply }),
      });
    } catch (err) {
      if (!(err instanceof AiUnavailableError) && !(err instanceof ProviderError)) {
        console.error(err); // 非 AI 侧异常要留原始堆栈，别只吐通用文案
      }
      const message =
        err instanceof AiUnavailableError || err instanceof ProviderError
          ? err.message
          : "服务器内部错误";
      await sse.writeSSE({ event: "error", data: JSON.stringify({ message }) });
    }
  });
});

chat.get("/sessions", (c) => {
  const rows = db
    .prepare(
      `SELECT s.id, s.title, s.created_at, s.updated_at,
              (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count,
              (SELECT m.content FROM chat_messages m WHERE m.session_id = s.id
                 AND m.role = 'assistant' AND m.content != ''
               ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_reply
       FROM chat_sessions s
       ORDER BY s.updated_at DESC, s.rowid DESC
       LIMIT 100`,
    )
    .all() as (ChatSessionRow & { message_count: number; last_reply: string | null })[];
  return c.json({ total: rows.length, sessions: rows });
});

chat.get("/sessions/:id", (c) => {
  const id = c.req.param("id");
  const session = db
    .prepare(`SELECT * FROM chat_sessions WHERE id = ?`)
    .get(id) as ChatSessionRow | undefined;
  if (!session) return c.json({ error: "会话不存在" }, 404);
  const messages = db
    .prepare(
      `SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at, rowid`,
    )
    .all(id) as ChatMessageRow[];
  return c.json({ session, messages });
});

chat.delete("/sessions/:id", (c) => {
  const id = c.req.param("id");
  const result = db.prepare(`DELETE FROM chat_sessions WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).run(id);
  if (result.changes === 0) return c.json({ error: "会话不存在" }, 404);
  return c.json({ ok: true, deleted_at: now() });
});
