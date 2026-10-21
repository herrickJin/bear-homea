import test from "node:test";
import assert from "node:assert/strict";
import { matchItem, preparationSeed, removePreparationItem } from "../src/data/preparation";
import { recordSeed } from "../src/data/mockRecords";
const bed = recordSeed.find(r => r.id === "bed")!;
test("matches mattress to mattress instead of the shorter bed name", () => {
  assert.equal(matchItem(bed, preparationSeed)?.name, "床垫");
  assert.equal(matchItem({ ...bed, category: "其他" }, preparationSeed)?.name, "床垫");
});
test("keeps associations within a room and respects explicit item selection", () => {
  assert.equal(matchItem({ ...bed, room: "阳台" }, preparationSeed), undefined);
  assert.equal(matchItem({ ...bed, itemId: "卫生间-2" }, preparationSeed)?.name, "洗手台");
  assert.equal(matchItem({ ...bed, itemId: "removed-item" }, preparationSeed), undefined);
});

test("deleting a preparation item preserves candidates without rematching and moves notes to the room", () => {
  const item = preparationSeed.find(i => i.name === "床垫")!;
  const candidate = { ...bed, category: "其他", itemId: undefined };
  const data = {
    items: preparationSeed, records: [candidate], skipped: [item.id, "other"],
    associations: { [`item:${item.id}`]: ["note-a", "note-b"], [`room:${item.room}`]: ["note-a"], "item:other": ["note-c"] },
    appliedImports: ["already-applied"],
  };
  const next = removePreparationItem(data, item.id);
  assert.ok(!next.items.some(i => i.id === item.id));
  assert.equal(next.records.length, 1);
  assert.equal(next.records[0].name, candidate.name);
  assert.equal(matchItem(next.records[0], next.items), undefined);
  assert.equal(matchItem(candidate, next.items)?.name, "床");
  assert.deepEqual(next.associations[`room:${item.room}`], ["note-a", "note-b"]);
  assert.equal(next.associations[`item:${item.id}`], undefined);
  assert.deepEqual(next.associations["item:other"], ["note-c"]);
  assert.deepEqual(next.skipped, ["other"]);
  assert.deepEqual(next.appliedImports, ["already-applied"]);
  assert.equal(data.items.length, preparationSeed.length);
});
test("deletes a custom empty item and leaves an unknown item unchanged", () => {
  const custom = { ...preparationSeed[0], id: "custom-test", name: "自定义" };
  const data = { items: [custom], records: [], skipped: [], associations: {} };
  assert.deepEqual(removePreparationItem(data, custom.id).items, []);
  assert.equal(removePreparationItem(data, "missing"), data);
});
