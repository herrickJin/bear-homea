import test from "node:test";
import assert from "node:assert/strict";
import { applyCentralAcImport } from "../src/data/centralAcImport";
import { preparationSeed, initialPreparationRecords } from "../src/data/preparation";
const base = () => ({ records: initialPreparationRecords.map(r => ({ ...r })), items: preparationSeed.map(i => ({ ...i })), skipped: ["全屋-0"], associations: {} as Record<string, string[]> });
test("reuses the existing central AC and preserves user quote, photos and selection", () => {
  const state = base();
  const ac = state.records.find(r => r.id === "hisense-central-ac")!;
  ac.price = 32000; ac.images = ["https://example.com/photo.png"]; ac.status = "shortlist";
  const result = applyCentralAcImport(state);
  const saved = result.records.find(r => r.id === ac.id)!;
  assert.equal(result.items.filter(i => i.room === "全屋" && i.name === "中央空调").length, 1);
  assert.equal(result.records.filter(r => r.id === ac.id).length, 1);
  assert.equal(saved.price, 32000); assert.deepEqual(saved.images, ac.images); assert.equal(saved.status, "shortlist");
  assert.ok(saved.analysis?.includes("尚未核实")); assert.ok(!result.skipped.includes("全屋-0"));
  assert.equal(applyCentralAcImport(result), result);
});
test("adds the requested item and candidate when absent, without changing other records", () => {
  const state = base();state.items = state.items.filter(i => i.id !== "全屋-0");state.records = state.records.filter(r => r.id !== "hisense-central-ac");
  const result = applyCentralAcImport(state);
  assert.equal(result.records.length, state.records.length + 1);
  assert.equal(result.records[0].room, "全屋");assert.equal(result.records[0].price, null);
  assert.deepEqual(result.records.slice(1), state.records);
});
