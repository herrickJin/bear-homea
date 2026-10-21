// AI 工具面接到应用侧真实数据（preparation_state）的回归：
// 读工具看得见准备项/候选，写工具把候选落进清单并递增 revision，快照不再看死表 entries。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bear-ai-prep-"));
process.env.DATA_DIR = dir;
process.env.BEAR_HOME_TOKEN = "test";

const { runAiTool, toolFailed, WRITE_TOOLS } = await import("../src/services/ai/tools.js");
const { readPreparationState, writePreparationState } = await import("../src/services/preparation-state.js");
const { buildSnapshot } = await import("../src/services/ai/agent.js");
const { db } = await import("../src/db/index.js");

const call = (name: string, args: unknown = {}) => runAiTool(name, JSON.stringify(args));

const item = (id: string, room: string, name: string, aliases: string[] = [name]) => ({
  id, room, name, aliases, fields: ["尺寸"], questions: ["含安装吗"],
});
const record = (id: string, over: Record<string, unknown> = {}) => ({
  id, room: "全屋", section: "soft", category: "中央空调", name: "海信 5匹",
  price: 39800, unit: "套", pros: "省电", cons: "安装费不明", note: "四室一厅",
  status: "saved", ...over,
});

const seed = {
  items: [item("central-ac", "全屋", "中央空调"), item("sofa", "客厅", "沙发"), item("tea-table", "客厅", "茶几")],
  records: [
    record("c-ac", { itemId: "central-ac", status: "shortlist", analysisSources: [{ label: "海信官网参数", url: "https://example.com/spec" }] }),
    record("c-loose", { room: "客厅", category: "茶几", name: "茶几（待归类）", price: null, unit: "件", note: "还没定", specs: { 材质: "岩板" } }),
  ],
  skipped: ["tea-table"],
  associations: { "item:central-ac": ["note-1"], "room:客厅": ["note-2"] },
  appliedImports: [],
};

test("preparation data is seeded through the shared writer", () => {
  const result = writePreparationState(0, seed as never);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.revision, 1);
  assert.equal(readPreparationState().data?.records.length, 2);
});

test("list_room_preparation returns items, candidates, selected, skipped and unassigned", () => {
  const all = call("list_room_preparation", { room: "全屋" }) as Record<string, any>;
  assert.equal(all.items.length, 1);
  assert.equal(all.items[0].name, "中央空调");
  assert.equal(all.items[0].selected, "海信 5匹");
  assert.equal(all.items[0].candidates[0].id, "c-ac");
  assert.deepEqual(all.items[0].noteIds, ["note-1"]);

  const living = call("list_room_preparation", { room: "客厅" }) as Record<string, any>;
  assert.equal(living.items.length, 2);
  assert.equal(living.items.find((i: { id: string }) => i.id === "tea-table").skipped, true);
  assert.equal(living.unassigned.length, 1);
  assert.deepEqual(living.roomNoteIds, ["note-2"]);
  assert.equal((call("list_room_preparation", { room: "地下室" }) as { error: string }).error, "bad_room");
});

test("list_candidates filters by room, item name and status", () => {
  assert.equal((call("list_candidates") as { total: number }).total, 2);
  assert.equal((call("list_candidates", { room: "全屋" }) as { total: number }).total, 1);
  assert.equal((call("list_candidates", { status: "shortlist" }) as { total: number }).total, 1);
  assert.equal((call("list_candidates", { itemName: "中央空调" }) as { total: number }).total, 1);
  assert.equal((call("list_candidates", { status: "nope" }) as { error: string }).error, "bad_status");
});

test("search_candidates reaches notes, pros and specs", () => {
  assert.equal((call("search_candidates", { keyword: "四室一厅" }) as { total: number }).total, 1);
  assert.equal((call("search_candidates", { keyword: "岩板" }) as { total: number }).total, 1);
  assert.equal((call("search_candidates", { keyword: "   " }) as { total: number }).total, 0);
});

test("get_candidate returns the full record plus its note links", () => {
  const full = call("get_candidate", { id: "c-ac" }) as Record<string, any>;
  assert.equal(full.itemName, "中央空调");
  assert.deepEqual(full.noteIds, ["note-1"]);
  assert.equal(full.price, 39800);
  assert.equal((call("get_candidate", { id: "missing" }) as { error: string }).error, "not_found");
});

test("add_candidate auto-assigns by category alias and bumps revision", () => {
  const result = call("add_candidate", {
    room: "客厅", name: "布艺沙发 A", category: "沙发", price: 7299, unit: "件", note: "宽 2.6 米",
  }) as Record<string, any>;
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(result.itemName, "沙发");
  assert.equal(result.candidate.itemId, "sofa");
  assert.equal(result.candidate.status, "saved");
  assert.equal(result.revision, 2);
  const stored = readPreparationState().data!;
  assert.equal(stored.records[0].id, result.candidate.id);
  assert.equal(stored.records[0].price, 7299);
});

test("auto-assign leaves items marked as not needed alone", () => {
  const auto = call("add_candidate", { room: "客厅", name: "岩板茶几", category: "茶几" }) as Record<string, any>;
  assert.equal(auto.candidate.itemId, null);
  assert.match(String(auto.hint), /待归类/);

  const named = call("add_candidate", { room: "客厅", name: "岩板茶几 2", category: "茶几", itemName: "茶几" }) as Record<string, any>;
  assert.equal(named.candidate.itemId, "tea-table");
});

test("add_candidate honours an explicit item name and defaults missing fields", () => {
  const named = call("add_candidate", { room: "全屋", name: "海信 140 外机", itemName: "中央空调", section: "hard", category: "主材" }) as Record<string, any>;
  assert.equal(named.candidate.itemId, "central-ac");
  assert.equal(named.candidate.price, null);
  assert.equal(named.candidate.unit, "件");
  assert.equal(named.candidate.section, "硬装");

  const loose = call("add_candidate", { room: "卫生间", name: "某款马桶" }) as Record<string, any>;
  assert.equal(loose.candidate.itemId, null);
  assert.equal(loose.itemName, null);
});

test("add_candidate can carry an analysis produced in the conversation", () => {
  const result = call("add_candidate", {
    room: "全屋", name: "海信 140 外机", itemName: "中央空调",
    analysis: "结论：先确认外机真实型号，再谈配置。\n\n资料范围：报价未核实。",
  }) as Record<string, any>;
  assert.equal(result.error, undefined, JSON.stringify(result));
  // 列表视图不带长文本，全文走 get_candidate
  assert.equal(result.candidate.analysis, undefined);
  const stored = call("get_candidate", { id: result.candidate.id }) as Record<string, any>;
  assert.match(stored.analysis, /先确认外机真实型号/);
});

test("save_candidate_analysis replaces the text and keeps the user's sources", () => {
  const revision = readPreparationState().revision;
  const saved = call("save_candidate_analysis", {
    id: "c-ac", analysis: "结论：留作候选，先出配机方案。\n\n下一步：索取全包落地价。",
  }) as Record<string, any>;
  assert.equal(saved.error, undefined, JSON.stringify(saved));
  assert.equal(saved.revision, revision + 1);

  const after = call("get_candidate", { id: "c-ac" }) as Record<string, any>;
  assert.equal(after.analysis, "结论：留作候选，先出配机方案。\n\n下一步：索取全包落地价。");
  assert.deepEqual(after.analysisSources, [{ label: "海信官网参数", url: "https://example.com/spec" }], "来源链接归用户，不该被模型清掉或改写");

  assert.equal((call("save_candidate_analysis", { id: "missing", analysis: "x" }) as { error: string }).error, "not_found");
  assert.equal((call("save_candidate_analysis", { id: "c-ac", analysis: "   " }) as { error: string }).error, "bad_request");
  const before = readPreparationState().revision;
  call("save_candidate_analysis", { id: "missing", analysis: "x" });
  call("save_candidate_analysis", { id: "c-ac", analysis: " " });
  assert.equal(readPreparationState().revision, before, "失败的分析写入不该动 revision");
});

test("add_candidate rejects unknown rooms without touching data", () => {
  const before = readPreparationState().revision;
  assert.equal((call("add_candidate", { room: "地下室", name: "吧台" }) as { error: string }).error, "bad_room");
  assert.equal(readPreparationState().revision, before);
});

test("add_candidate sanitises anything the model made up", () => {
  const result = call("add_candidate", {
    room: "厨房", name: "洗碗机", price: -5, unit: "", category: "", url: "javascript:alert(1)",
  }) as Record<string, any>;
  assert.equal(result.candidate.price, null);
  assert.equal(result.candidate.unit, "件");
  assert.equal(result.candidate.category, "其他");
  assert.equal(result.candidate.url, null);
});

test("snapshot reads preparation, not the dead entries table", () => {
  db.prepare(
    `INSERT INTO entries (id, title, body, stage, date, created_at, updated_at)
     VALUES ('e1', '旧记录', '', '水电', '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  ).run();
  const snapshot = buildSnapshot();
  assert.match(snapshot, /装修准备：\d+ 个准备项/);
  assert.match(snapshot, /客厅/);
  assert.ok(!snapshot.includes("旧记录"), "entries 不该再进快照");
  assert.match(snapshot, /笔记库/);
});

test("write tools are declared so the client gets a refresh signal", () => {
  assert.ok(WRITE_TOOLS.has("add_candidate"));
  assert.ok(WRITE_TOOLS.has("save_candidate_analysis"));
  assert.equal(toolFailed(call("add_candidate", { room: "客厅" })), true);
  assert.equal(toolFailed(call("list_candidates")), false);
});

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
