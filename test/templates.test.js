const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const { FileStore } = require("../src/storage/fileStore");

describe("Templates", () => {
  let store;
  let tmpDir;

  before(async () => {
    tmpDir = path.join(os.tmpdir(), `noia-test-tmpl-${Date.now()}`);
    await fs.mkdir(path.join(tmpDir, "templates"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "runs"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "agents"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "exports"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "topics"), { recursive: true });
    store = new FileStore(tmpDir);
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("saveTemplate returns object with tmpl- id and createdAt", async () => {
    const tmpl = await store.saveTemplate({ name: "Battery Research", topic: "Solid-state batteries", rounds: 4 });
    assert.ok(tmpl.id.startsWith("tmpl-"));
    assert.ok(tmpl.createdAt);
    assert.strictEqual(tmpl.name, "Battery Research");
    assert.strictEqual(tmpl.topic, "Solid-state batteries");
    assert.strictEqual(tmpl.rounds, 4);
  });

  it("listTemplates returns saved templates sorted by date", async () => {
    await store.saveTemplate({ name: "First" });
    await new Promise((r) => setTimeout(r, 10));
    await store.saveTemplate({ name: "Second" });
    const templates = await store.listTemplates();
    assert.ok(templates.length >= 2);
    assert.strictEqual(templates[0].name, "Second");
  });

  it("loadTemplate returns the saved template", async () => {
    const saved = await store.saveTemplate({ name: "Loadable", topic: "Test topic" });
    const loaded = await store.loadTemplate(saved.id);
    assert.strictEqual(loaded.id, saved.id);
    assert.strictEqual(loaded.name, "Loadable");
    assert.strictEqual(loaded.topic, "Test topic");
  });

  it("loadTemplate throws 404 for missing template", async () => {
    await assert.rejects(() => store.loadTemplate("tmpl-nonexistent"), (err) => {
      assert.strictEqual(err.statusCode, 404);
      return true;
    });
  });

  it("deleteTemplate removes the file", async () => {
    const saved = await store.saveTemplate({ name: "Deletable" });
    await store.deleteTemplate(saved.id);
    await assert.rejects(() => store.loadTemplate(saved.id), (err) => {
      assert.strictEqual(err.statusCode, 404);
      return true;
    });
  });
});
