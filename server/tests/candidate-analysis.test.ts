// 选购分析接口：只产出 analysis 文本、不落库、不调工具；来源链接由用户维护，不由模型生成。
import test from "node:test";
import assert from "node:assert/strict";

process.env.BEAR_HOME_TOKEN = "test-only";
process.env.AI_API_KEY = "test-only";
process.env.AI_API_BASE = "https://example.invalid/v1";
const { analyze } = await import("../src/routes/analyze.js");
const { config } = await import("../src/config.js");
const { parseAnalysis, ANALYSIS_MAX_CHARS } = await import("../src/services/ai/candidate-analysis.js");

const sample = { room: "全屋", name: "海信 5G+荣耀家 · 5匹", itemName: "中央空调", category: "中央空调", section: "soft", price: null, unit: "套", note: "分享文案：多联机5匹四室一厅", pros: "", cons: "", specs: { 外机型号: "待核实" } };
const analysis = "作为全屋中央空调候选保留，先确认配置和安装总价。\n\n资料范围：型号与价格未核实。\n\n下一步：向外机型号与全包落地价。";

test("parseAnalysis accepts fenced JSON and rejects junk", () => {
  assert.deepEqual(parseAnalysis('```json\n{"analysis":"a"}\n```'), { analysis: "a" });
  assert.throws(() => parseAnalysis("不是 JSON"));
  assert.throws(() => parseAnalysis(JSON.stringify({ analysis: "  " })));
  assert.throws(() => parseAnalysis(JSON.stringify({ analysis: "x".repeat(ANALYSIS_MAX_CHARS + 1) })));
});

test("validates input, reports availability and missing credentials", async () => {
  const request = (body: unknown) => analyze.request("/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await (await analyze.request("/")).json()).available, true);
  assert.equal((await request({ name: "沙发" })).status, 400);
  assert.equal((await request({ room: "客厅", name: " " })).status, 400);
  assert.equal((await request({ room: "客厅", name: "沙发", price: -1 })).status, 400);

  const key = config.ai.apiKey;
  config.ai.apiKey = "";
  assert.equal((await (await analyze.request("/")).json()).available, false);
  assert.equal((await request({ room: "客厅", name: "沙发" })).status, 503);
  config.ai.apiKey = key;
});

test("returns the analysis text and sends no tools", async () => {
  const originalFetch = globalThis.fetch;
  let sent: { tools?: unknown; messages: { role: string; content: string }[] } | undefined;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options?.body as string);
    const payload = JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ analysis }) }, finish_reason: "stop" }] });
    return new Response(`data: ${payload}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  };
  try {
    const res = await analyze.request("/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sample) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { analysis });
    assert.equal(sent?.tools, undefined, "分析不应带工具");
    assert.match(sent!.messages[0].content, /不得声称查过网页|不要编造来源/);
    // 候选事实原样交给模型：没核实的参数不能被“补全”
    assert.match(sent!.messages[1].content, /待核实/);
    assert.match(sent!.messages[1].content, /中央空调/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps bad model output and transport failures to 502", async () => {
  const originalFetch = globalThis.fetch;
  const request = (body: unknown) => analyze.request("/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"no json"}}]}\n\n');
    assert.equal((await request(sample)).status, 502);
    globalThis.fetch = async () => { throw new Error("network failure"); };
    assert.equal((await request(sample)).status, 502);
    globalThis.fetch = async () => { throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); };
    assert.equal((await request(sample)).status, 504);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
