import test from "node:test";
import assert from "node:assert/strict";

process.env.BEAR_HOME_TOKEN = "test-only";
process.env.AI_API_KEY = "test-only";
process.env.AI_API_BASE = "https://example.invalid/v1";
const { recordDraft } = await import("../src/routes/record-draft.js");
const { config } = await import("../src/config.js");
const { parseDraft } = await import("../src/services/ai/record-draft.js");
const draft = { name: "布艺沙发", price: 7299, unit: "件", room: "客厅", section: "soft", category: "沙发", note: "宽 2.6 米", pros: "坐着舒服", cons: "" };

test("validates fenced JSON and rejects invalid price or room", () => {
  assert.deepEqual(parseDraft('```json\n' + JSON.stringify(draft) + '\n```'), draft);
  for (const bad of [{ ...draft, price: -1 }, { ...draft, room: "书房" }, { ...draft, name: "" }, { ...draft, price: "7299" }]) {
    assert.throws(() => parseDraft(JSON.stringify(bad)));
  }
});
test("validates input, handles missing credentials, and returns a draft without tools", async () => {
  const request = (body: unknown) => recordDraft.request("/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await request({ text: " " })).status, 400);
  assert.equal((await request({ text: "a".repeat(2001) })).status, 400);
  const key = config.ai.apiKey;
  config.ai.apiKey = "";
  assert.equal((await request({ text: "沙发" })).status, 503);
  config.ai.apiKey = key;
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options?.body as string);
    const payload = JSON.stringify({ choices: [{ delta: { content: JSON.stringify(draft) }, finish_reason: "stop" }] });
    return new Response(`data: ${payload}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  };
  try {
    const res = await request({ text: "客厅沙发7299元，宽2.6米，坐着舒服", room: "客厅" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { draft });
    assert.equal((sent as { tools?: unknown }).tools, undefined);
    globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"invalid"}}]}\n\n');
    assert.equal((await request({ text: "沙发" })).status, 502);
    globalThis.fetch = async () => { throw new Error("network failure"); };
    assert.equal((await request({ text: "沙发" })).status, 502);
  } finally { globalThis.fetch = originalFetch; }
});
