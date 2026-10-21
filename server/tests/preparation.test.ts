import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bear-preparation-"));
process.env.DATA_DIR = dir;
process.env.BEAR_HOME_TOKEN = "test";
const { preparation } = await import("../src/routes/preparation.js");
const { db } = await import("../src/db/index.js");
const data = { items: [{ id: "sofa", room: "客厅", name: "沙发", fields: [], questions: [], aliases: ["沙发"] }], records: [{ id: "one", itemId: "sofa", room: "客厅", section: "soft", category: "沙发", name: "沙发 A", price: null, unit: "件", pros: "", cons: "", note: "", status: "shortlist", images: ["https://example.com/a.jpg", "https://example.com/b.jpg"] }], skipped: [], associations: { "item:sofa": ["note-1"] } };
const put = (revision: number, state: unknown) => preparation.request("/", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, data: state }) });
test("atomic persistence, conflict protection, validation and recovery", async () => {
  assert.equal((await (await preparation.request("/")).json()).data, null);
  assert.equal((await put(0, data)).status, 200);
  const loaded = await (await preparation.request("/")).json();
  assert.equal(loaded.revision, 1); assert.deepEqual(loaded.data, data);
  assert.equal((await put(0, { ...data, records: [] })).status, 409);
  assert.equal((await put(1, { ...data, records: [...data.records, { ...data.records[0], id: "two" }] })).status, 400);
  assert.equal((await put(1, { ...data, records: [{ ...data.records[0], images: Array(10).fill("https://example.com/a.jpg") }] })).status, 400);
  assert.equal((await put(1, { ...data, records: [{ ...data.records[0], price: -1 }] })).status, 400);
  assert.equal((await put(1, { ...data, records: [{ ...data.records[0], room: "餐厅" }] })).status, 400);
  // Deleted preparation items deliberately leave candidates unassigned.
  assert.equal((await put(1, { ...data, items: [], associations: { "room:客厅": ["note-1"] } })).status, 200);
  const row = db.prepare("SELECT body FROM preparation_state WHERE id=1").get() as { body: string };
  assert.equal(JSON.parse(row.body).records[0].images.length, 2);
  db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
