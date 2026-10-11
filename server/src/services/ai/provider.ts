// OpenAI 兼容 chat/completions 客户端（流式）。
// 智谱 GLM 等国内可达端点均按此协议工作；凭据只走环境变量（config.ai）。

export type ProviderMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ProviderToolCallRequest[];
  tool_call_id?: string;
};

export type ProviderToolCallRequest = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** 模型在流里声明要调的工具（arguments 是待解析的 JSON 文本） */
export type ProviderToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ProviderToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_calls"; toolCalls: ProviderToolCall[] }
  | { type: "finish"; finishReason: string | null };

type ChunkChoice = {
  delta?: {
    content?: string | null;
    tool_calls?: {
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }[];
  };
  finish_reason?: string | null;
};

export class ProviderError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * 流式发起一次补全。text_delta 按序吐出文本增量；
 * 若模型发起工具调用，流结束时以单个 tool_calls 事件交出聚合结果。
 */
export async function* streamChatCompletion(options: {
  apiKey: string;
  apiBase: string;
  model: string;
  messages: ProviderMessage[];
  tools?: ProviderToolSchema[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const base = options.apiBase.replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      ...(options.tools?.length ? { tools: options.tools } : {}),
      stream: true,
    }),
    signal: options.signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new ProviderError(
      res.status,
      `模型端点返回 ${res.status}${detail ? `：${detail.slice(0, 300)}` : ""}`,
    );
  }

  const partials: ProviderToolCall[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finishReason: string | null = null;

  const feed = (payload: string): StreamEvent[] => {
    const events: StreamEvent[] = [];
    for (const rawLine of payload.split("\n")) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let chunk: { choices?: ChunkChoice[] };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue; // 端点偶发的非 JSON 行直接跳过
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.content) {
        events.push({ type: "text_delta", text: choice.delta.content });
      }
      for (const tc of choice.delta?.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        partials[idx] ??= { id: "", name: "", arguments: "" };
        if (tc.id) partials[idx].id = tc.id;
        if (tc.function?.name) partials[idx].name += tc.function.name;
        if (tc.function?.arguments) partials[idx].arguments += tc.function.arguments;
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    return events;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      // SSE 事件以空行分隔；逐事件消费，残包留到下一轮
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const events = feed(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
        for (const event of events) yield event;
      }
    }
    for (const event of feed(buffer + "\n\n")) yield event;
  } finally {
    reader.releaseLock();
  }

  const toolCalls = partials.filter((p) => p.id || p.name);
  if (toolCalls.length > 0) {
    yield { type: "tool_calls", toolCalls };
  }
  yield { type: "finish", finishReason };
}
