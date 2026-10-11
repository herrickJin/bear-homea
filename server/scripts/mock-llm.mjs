// 本地开发用的假 LLM：OpenAI 兼容 /chat/completions（流式 + 非流式）。
// 用途：不配真实 AI_API_KEY 也能端到端验证 /api/chat 的工具调用循环与 SSE。
// 启动：node scripts/mock-llm.mjs [port]   （默认 9393）
//
// 剧本（按用户最后一条消息路由）：
//   含「记」 → 发起 create_entry 工具调用；工具结果回来后给结论文本
//   含「查」 → 发起 search_entries 工具调用；工具结果回来后给结论文本
//   其他     → 直接文本回复
// 工具参数按增量分片下发，专门用来考验客户端的 SSE 聚合逻辑。

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 9393);

const textReply = (req) =>
  [
    "（mock）收到：「" + (req.messages.at(-1)?.content ?? "").slice(0, 20) + "」。",
    "这是模拟模型回复，说明 /api/chat 全链路通了。",
  ].join(" ");

const scriptedCall = (req) => {
  const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
  const text = lastUser?.content ?? "";
  if (text.includes("记")) {
    return {
      id: "mock-call-create",
      name: "create_entry",
      arguments: JSON.stringify({
        title: "Mock 联调记录",
        body: "由 mock-llm 创建，验证 create_entry 工具链路",
        stage: "准备",
      }),
    };
  }
  return {
    id: "mock-call-search",
    name: "search_entries",
    arguments: JSON.stringify({ keyword: "水电", limit: 5 }),
  };
};

function writeSSE(res, payload) {
  res.write("data: " + JSON.stringify(payload) + "\n\n");
}

async function streamResponse(req, res) {
  console.error("mock 收到消息数:", req.messages.length, "roles:", req.messages.map((m) => m.role).join(","));
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const sawToolResult = req.messages.some((m) => m.role === "tool");
  if (sawToolResult) {
    for (const piece of ["收到工具结果了。", "（mock）", "链路验证完成。"]) {
      writeSSE(res, {
        id: "mock",
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
      });
      await new Promise((r) => setTimeout(r, 20));
    }
    writeSSE(res, {
      id: "mock",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
  } else {
    const call = scriptedCall(req);
    // 名字整发、参数分三片——客户端要能聚合
    writeSSE(res, {
      id: "mock",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, id: call.id, type: "function", function: { name: call.name, arguments: "" } }],
          },
          finish_reason: null,
        },
      ],
    });
    const args = call.arguments;
    const third = Math.ceil(args.length / 3);
    for (let i = 0; i < args.length; i += third) {
      writeSSE(res, {
        id: "mock",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + third) } }],
            },
            finish_reason: null,
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 10));
    }
    writeSSE(res, {
      id: "mock",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    });
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let parsed = { messages: [], stream: false };
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (parsed.stream) {
      void streamResponse(parsed, res);
      return;
    }
    const sawToolResult = parsed.messages.some((m) => m.role === "tool");
    const content = sawToolResult
      ? "收到工具结果了。（mock）非流式链路验证完成。"
      : textReply(parsed);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "mock",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
      }),
    );
  });
});

server.listen(port, () => {
  console.log("mock-llm 已启动: http://localhost:" + port + "/v1/chat/completions");
});
