const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

// Override config.dataDir before loading FileStore
let tmpDir;
let store;

async function createTempStore() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "noia-test-"));
  // Create required subdirectories
  await fs.mkdir(path.join(tmpDir, "runs"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, "agents"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, "exports"), { recursive: true });

  // Load FileStore with temp dir
  const { FileStore } = require("../src/storage/fileStore");
  return new FileStore(tmpDir);
}

async function cleanupTemp() {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe("FileStore", () => {
  beforeEach(async () => {
    store = await createTempStore();
  });

  afterEach(async () => {
    await cleanupTemp();
  });

  it("createRunRecord returns valid structure", async () => {
    const run = await store.createRunRecord({
      topic: "test topic",
      title: "Test",
      rounds: 3,
      settings: {}
    });
    assert.ok(run.id.startsWith("run-"));
    assert.equal(run.topic, "test topic");
    assert.equal(run.rounds, 3);
    assert.deepEqual(run.roundMessages, []);
  });

  it("saveRun and loadRun round-trip", async () => {
    const run = await store.createRunRecord({ topic: "test", title: "T", rounds: 2, settings: {} });
    run.metadata = { status: "completed" };
    await store.saveRun(run);

    const loaded = await store.loadRun(run.id);
    assert.equal(loaded.id, run.id);
    assert.equal(loaded.metadata.status, "completed");
  });

  it("loadRun throws 404 for missing run", async () => {
    await assert.rejects(() => store.loadRun("nonexistent-run"), (err) => {
      assert.equal(err.statusCode, 404);
      return true;
    });
  });

  it("listRuns returns saved runs sorted by date", async () => {
    const run1 = await store.createRunRecord({ topic: "first", title: "A", rounds: 2, settings: {} });
    run1.metadata = { status: "completed" };
    await store.saveRun(run1);

    const run2 = await store.createRunRecord({ topic: "second", title: "B", rounds: 2, settings: {} });
    run2.metadata = { status: "running" };
    await store.saveRun(run2);

    const runs = await store.listRuns();
    assert.equal(runs.length, 2);
    // Most recent first
    assert.equal(runs[0].topic, "second");
  });

  it("listRuns uses cache on second call", async () => {
    const run = await store.createRunRecord({ topic: "cached", title: "C", rounds: 2, settings: {} });
    run.metadata = { status: "completed" };
    await store.saveRun(run);

    const first = await store.listRuns();
    const second = await store.listRuns();
    assert.equal(first.length, second.length);
  });

  it("readText returns fallback for missing file", async () => {
    const result = await store.readText(path.join(tmpDir, "missing.txt"), "default");
    assert.equal(result, "default");
  });

  it("writeText and readText round-trip", async () => {
    const filePath = path.join(tmpDir, "test.txt");
    await store.writeText(filePath, "hello");
    const result = await store.readText(filePath);
    assert.equal(result, "hello");
  });

  it("writeJson and readJson round-trip", async () => {
    const filePath = path.join(tmpDir, "test.json");
    await store.writeJson(filePath, { key: "value" });
    const result = await store.readJson(filePath);
    assert.deepEqual(result, { key: "value" });
  });
});
