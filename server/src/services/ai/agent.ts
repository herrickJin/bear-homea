// AI 助手核心：系统提示词（项目快照 + 页面上下文注入）+ 工具调用循环 + 会话持久化。
// 与 Hermes 的分工：这里服务 App 内的实时探讨（同步上下文、亚秒首响），
// Hermes 容器做常驻异步智能（链接队列、cron、消息网关），两者共用同一数据库。

import { randomUUID } from "node:crypto";
import { db, now, today } from "../../db/index.js";
import type { ChatMessageRow, ChatSessionRow, LinkRow } from "../../db/schema.js";
import { config } from "../../config.js";
import {
  emptyPreparationState,
  readPreparationState,
  rooms,
  type PreparationState,
} from "../preparation-state.js";
import {
  streamChatCompletion,
  type ProviderMessage,
  type ProviderToolCall,
} from "./provider.js";
import { aiToolSchemas, runAiTool, toolFailed, WRITE_TOOLS } from "./tools.js";

export class AiUnavailableError extends Error {}

export type ChatContext = {
  page?: string;
  ref?: unknown;
};

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; name: string }
  | { type: "tool_done"; name: string };

const HISTORY_LIMIT = 20;
const TOOL_RESULT_MAX_CHARS = 30000;
const CONTEXT_MAX_CHARS = 4000;

const countBy = (rows: { status?: string }[], key: "status") => {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = row[key];
    if (value) counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
};

/**
 * 项目快照：让模型不查表也知道家现在到哪一步了。
 * 数据源必须与应用侧可见的数据一致：装修准备（preparation_state）+ 笔记库（links）。
 * 旧的 entries 表应用侧从不写入也不展示，不进快照，免得快照说「没有记录」而其实有候选。
 */
export function buildSnapshot(): string {
  const state: PreparationState = readPreparationState().data ?? emptyPreparationState();
  const itemName = new Map(state.items.map(i => [i.id, i.name]));

  const lines: string[] = [];
  const unassigned = state.records.filter(r => !r.itemId).length;
  lines.push(
    `- 装修准备：${state.items.length} 个准备项、${state.records.length} 条候选（含 ${unassigned} 条待归类），status：saved 已记录 / shortlist 已选定 / bought 已买`,
  );
  for (const room of rooms) {
    const items = state.items.filter(i => i.room === room);
    const records = state.records.filter(r => r.room === room);
    if (!items.length && !records.length) continue;
    const skipped = state.skipped.filter(id => items.some(i => i.id === id)).length;
    const picked = records.filter(r => r.status === "shortlist").map(r => r.name.slice(0, 24));
    lines.push(
      `  · ${room}：准备项 ${items.length} 个（暂不需要 ${skipped} 个）、候选 ${records.length} 条` +
        (picked.length ? `，已选定：${picked.join("、")}` : ""),
    );
  }
  const featured = [
    ...state.records.filter(r => r.status === "shortlist"),
    ...state.records.filter(r => r.status !== "shortlist"),
  ].slice(0, 12);
  for (const r of featured) {
    const price = r.price === null ? "价格未知" : `¥${r.price}/${r.unit}`;
    lines.push(
      `  · [${r.status}] ${r.room} · ${itemName.get(r.itemId ?? "") ?? "待归类"} · ${r.name.slice(0, 40)} · ${price}`,
    );
  }

  const links = db
    .prepare(
      `SELECT status, title, summary FROM links ORDER BY created_at DESC LIMIT 8`,
    )
    .all() as Pick<LinkRow, "status" | "title" | "summary">[];
  const linkTotal = (
    db.prepare(`SELECT COUNT(*) AS n FROM links`).get() as { n: number }
  ).n;

  lines.push(
    "- 笔记库（收藏的第三方内容）：共 " +
      linkTotal +
      " 条，按状态 " +
      JSON.stringify(countBy(links, "status")),
  );
  for (const l of links) {
    const label = l.title ?? "（待抓取）";
    const summary = (l.summary ?? "").slice(0, 60);
    lines.push("  · [" + l.status + "] " + label.slice(0, 40) + (summary ? "：" + summary : ""));
  }
  return lines.join("\n");
}

function buildSystemPrompt(context: ChatContext | undefined): string {
  const parts: string[] = [];
  parts.push(
    [
      "你是「小熊」，熊熊之家 App 里的装修助手。屋主是第一次装修的小两口，正处在装修周期里。",
      "说话简洁、口语化、说人话，别堆术语；给出建议时给理由，有分歧时摆事实让屋主自己定。",
      "回答里涉及他家的事实（准备项、候选商品、报价、收藏的笔记）时，优先用工具查证，不要凭空编。",
      "报价是屋主自己记下的数字，不是市场价；价格未知就直说未知，不要替商家估价或编型号。",
      "屋主说「记下来 / 帮我记着」时，把确认过的内容用 add_candidate 落成候选（room 和 name 必填，price 只填他明确说过的数字）。",
      "归不进准备项的候选会进「待归类」，这是正常的，让屋主之后自己认领，不要硬塞。",
      "屋主让你分析某款商品时，用 save_candidate_analysis 把结论写进那条候选：第一段先给 2~3 句结论，后面分段说依据和还要向商家核实什么；你没有联网能力，不要编造来源链接或参数。",
      "涉及金额与施工的判断，提醒这只是参考，重要决定找工长/设计师确认。",
    ].join("\n"),
  );
  parts.push("今天是 " + today() + "。");
  parts.push("## 他家的现状\n" + buildSnapshot());
  if (context && (context.page || context.ref)) {
    let contextText = "";
    try {
      contextText = JSON.stringify(context) ?? "";
    } catch {
      contextText = "";
    }
    parts.push(
      "## 屋主当前正在看\n（前端注入的上下文，讨论围绕它展开）\n" +
        contextText.slice(0, CONTEXT_MAX_CHARS),
    );
  }
  return parts.join("\n\n");
}

/** 从持久化行还原 OpenAI 协议消息；窗口开头若切在工具链中间则推进到第一条 user 行，
 *  保证 tool_calls 与 tool 结果成对；窗口内没有 user 行（超长工具链被截）就整体丢弃 */
function historyToProviderMessages(rows: ChatMessageRow[]): ProviderMessage[] {
  let start = 0;
  if (rows.length && rows[0].role !== "user") {
    const firstUser = rows.findIndex((r) => r.role === "user");
    start = firstUser === -1 ? rows.length : firstUser;
  }
  const messages: ProviderMessage[] = [];
  for (const row of rows.slice(start)) {
    if (row.role === "assistant" && row.tool_calls) {
      let toolCalls: ProviderToolCall[] = [];
      try {
        const parsed = JSON.parse(row.tool_calls) as ProviderToolCall[];
        toolCalls = parsed.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: typeof tc.arguments === "string" ? tc.arguments : "{}",
        }));
      } catch {
        toolCalls = [];
      }
      messages.push({
        role: "assistant",
        content: row.content || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });
    } else if (row.role === "tool") {
      messages.push({
        role: "tool",
        content: row.content,
        tool_call_id: row.tool_call_id ?? "",
      });
    } else {
      messages.push({ role: row.role, content: row.content });
    }
  }
  return messages;
}

const insertMessage = (row: Omit<ChatMessageRow, "id" | "created_at">) => {
  const full: ChatMessageRow = {
    id: "msg-" + Date.now() + "-" + randomUUID().slice(0, 8),
    created_at: now(),
    ...row,
  };
  db.prepare(
    `INSERT INTO chat_messages (id, session_id, role, content, tool_calls, tool_call_id, name, created_at)
     VALUES (@id, @session_id, @role, @content, @tool_calls, @tool_call_id, @name, @created_at)`,
  ).run(full);
};

export function ensureSession(sessionId: string | undefined): ChatSessionRow {
  if (sessionId) {
    const row = db
      .prepare(`SELECT * FROM chat_sessions WHERE id = ?`)
      .get(sessionId) as ChatSessionRow | undefined;
    if (row) return row;
  }
  const row: ChatSessionRow = {
    id: "chat-" + Date.now() + "-" + randomUUID().slice(0, 8),
    title: "",
    context: null,
    created_at: now(),
    updated_at: now(),
  };
  db.prepare(
    `INSERT INTO chat_sessions (id, title, context, created_at, updated_at)
     VALUES (@id, @title, @context, @created_at, @updated_at)`,
  ).run(row);
  return row;
}

/**
 * 跑一轮对话：历史 + 新消息 → （工具循环）→ 回复。
 * 全程流式，文本增量通过 onEvent 吐出；所有消息（含工具往返）落库。
 */
export async function runChat(options: {
  sessionId: string | undefined;
  message: string;
  context?: ChatContext;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}): Promise<{ sessionId: string; reply: string; changed: string[] }> {
  const { apiKey, apiBase, model, maxToolRounds } = config.ai;
  if (!apiKey) throw new AiUnavailableError("未配置 AI_API_KEY");

  const session = ensureSession(options.sessionId);
  const emit = (event: AgentEvent) => options.onEvent?.(event);
  // AI 改过应用侧数据就记下来：前端据此刷新，否则本地 revision 会过期撞 409
  const changed = new Set<string>();

  if (!session.title) {
    db.prepare(`UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?`).run(
      options.message.trim().slice(0, 24) || "新对话",
      now(),
      session.id,
    );
  } else {
    db.prepare(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`).run(
      now(),
      session.id,
    );
  }

  // 取最近 N 条（倒序取再反转），再从最后一条 user 行起截断，保证
  // assistant(tool_calls) 与其 tool 结果成对保留
  const recentRows = (
    db
      .prepare(
        `SELECT * FROM chat_messages WHERE session_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(session.id, HISTORY_LIMIT) as unknown as ChatMessageRow[]
  ).reverse();

  insertMessage({
    session_id: session.id,
    role: "user",
    content: options.message.trim().slice(0, 8000),
    tool_calls: null,
    tool_call_id: null,
    name: null,
  });

  const messages: ProviderMessage[] = [
    { role: "system", content: buildSystemPrompt(options.context) },
    ...historyToProviderMessages(recentRows),
    { role: "user", content: options.message.trim().slice(0, 8000) },
  ];

  let reply = "";
  for (let round = 0; round <= maxToolRounds; round++) {
    let roundText = "";
    let toolCalls: ProviderToolCall[] = [];
    const stream = streamChatCompletion({
      apiKey,
      apiBase,
      model,
      messages,
      tools: aiToolSchemas,
      signal: options.signal,
    });
    for await (const value of stream) {
      if (value.type === "text_delta") {
        roundText += value.text;
        emit({ type: "text_delta", text: value.text });
      } else if (value.type === "tool_calls") {
        toolCalls = value.toolCalls;
      }
    }

    if (toolCalls.length === 0) {
      reply = roundText;
      if (roundText) {
        insertMessage({
          session_id: session.id,
          role: "assistant",
          content: roundText,
          tool_calls: null,
          tool_call_id: null,
          name: null,
        });
      }
      break;
    }

    // 模型要调工具：落库 assistant(tool_calls) + 每个工具结果，然后带结果再进一轮
    insertMessage({
      session_id: session.id,
      role: "assistant",
      content: roundText,
      tool_calls: JSON.stringify(
        toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
      ),
      tool_call_id: null,
      name: null,
    });
    messages.push({
      role: "assistant",
      content: roundText || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });
    for (const tc of toolCalls) {
      emit({ type: "tool_start", name: tc.name });
      const result = runAiTool(tc.name, tc.arguments);
      if (WRITE_TOOLS.has(tc.name) && !toolFailed(result)) changed.add("preparation");
      const resultText = JSON.stringify(result).slice(0, TOOL_RESULT_MAX_CHARS);
      insertMessage({
        session_id: session.id,
        role: "tool",
        content: resultText,
        tool_calls: null,
        tool_call_id: tc.id,
        name: tc.name,
      });
      messages.push({ role: "tool", content: resultText, tool_call_id: tc.id });
      emit({ type: "tool_done", name: tc.name });
    }
    reply = roundText;
  }

  db.prepare(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`).run(
    now(),
    session.id,
  );
  return { sessionId: session.id, reply, changed: [...changed] };
}
