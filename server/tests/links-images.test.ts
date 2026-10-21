import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bear-link-images-"));
process.env.DATA_DIR = dir;
process.env.BEAR_HOME_TOKEN = "test";
// Start from the previous schema to exercise migration with an existing image.
const legacy = new Database(path.join(dir, "bear-home.db"));
legacy.exec(`CREATE TABLE links (
  id TEXT PRIMARY KEY, url TEXT, title TEXT, summary TEXT, content TEXT,
  note TEXT, category_ids TEXT DEFAULT '[]', shot_url TEXT, cover_url TEXT,
  source TEXT, status TEXT DEFAULT 'pending', error TEXT, created_at TEXT, updated_at TEXT
); INSERT INTO links (id, note, shot_url, status) VALUES ('legacy', '旧笔记', '/files/old.png', 'done');`);
legacy.close();
const { links } = await import("../src/routes/links.js");
const { db } = await import("../src/db/index.js");
const post = (body: unknown) => links.request("/", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
test("multiple images persist, image-only notes save, and legacy images survive migration", async () => {
  try {
    const legacyRow = await (await links.request("/legacy")).json();
    assert.equal(legacyRow.shot_url, "/files/old.png");
    assert.equal(legacyRow.shot_urls, "[]");
    const images = ["/files/a.png", "/files/b.png", "/files/c.png"];
    const response = await post({ shot_urls: images });
    assert.equal(response.status, 201);
    const saved = await response.json();
    const loaded = await (await links.request(`/${saved.id}`)).json();
    assert.deepEqual(JSON.parse(loaded.shot_urls), images);
    assert.equal(loaded.shot_url, images[0]);
    const list = await (await links.request("/")).json();
    assert.deepEqual(JSON.parse(list.links.find((row: { id: string }) => row.id === saved.id).shot_urls), images);
    const update = await links.request(`/${saved.id}/update`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: "补充想法" }) });
    assert.deepEqual(JSON.parse((await update.json()).shot_urls), images);
    const single = await post({ shot_url: "/files/single.png" });
    assert.equal(single.status, 201);
    assert.deepEqual(JSON.parse((await single.json()).shot_urls), ["/files/single.png"]);
    assert.equal((await post({})).status, 400);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
