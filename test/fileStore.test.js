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

    const result = await store.listRuns();
    assert.equal(result.runs.length, 2);
    assert.equal(result.total, 2);
    // Most recent first
    assert.equal(result.runs[0].topic, "second");
  });

  it("listRuns uses cache on second call", async () => {
    const run = await store.createRunRecord({ topic: "cached", title: "C", rounds: 2, settings: {} });
    run.metadata = { status: "completed" };
    await store.saveRun(run);

    const first = await store.listRuns();
    const second = await store.listRuns();
    assert.equal(first.runs.length, second.runs.length);
  });

  it("saveRun creates .meta.json alongside run file", async () => {
    const run = await store.createRunRecord({ topic: "meta test", title: "M", rounds: 2, settings: {} });
    run.metadata = { status: "running" };
    await store.saveRun(run);

    const meta = await store.readJson(store.runMetaPath(run.id));
    assert.equal(meta.id, run.id);
    assert.equal(meta.status, "running");
    assert.equal(meta.title, "M");
  });

  it("listRuns returns paginated results", async () => {
    for (let i = 0; i < 5; i++) {
      const run = await store.createRunRecord({ topic: `topic ${i}`, title: `T${i}`, rounds: 2, settings: {} });
      run.metadata = { status: "completed" };
      await store.saveRun(run);
    }

    const page1 = await store.listRuns({ page: 1, limit: 2 });
    assert.equal(page1.runs.length, 2);
    assert.equal(page1.total, 5);
    assert.equal(page1.page, 1);

    const page3 = await store.listRuns({ page: 3, limit: 2 });
    assert.equal(page3.runs.length, 1);
  });

  it("recoverStaleRuns marks running runs as interrupted", async () => {
    const run = await store.createRunRecord({ topic: "stale", title: "S", rounds: 2, settings: {} });
    run.metadata = { status: "running" };
    await store.saveRun(run);

    const recovered = await store.recoverStaleRuns();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0], run.id);

    const loaded = await store.loadRun(run.id);
    assert.equal(loaded.metadata.status, "interrupted");

    const meta = await store.readJson(store.runMetaPath(run.id));
    assert.equal(meta.status, "interrupted");
  });

  it("migrateMetaFiles creates meta for existing runs", async () => {
    const runId = "run-legacy-test";
    const run = { id: runId, title: "Legacy", topic: "old", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: { status: "completed" }, roundMessages: [], rounds: 2 };
    await store.writeJson(store.runPath(runId), run);

    await store.migrateMetaFiles();

    const meta = await store.readJson(store.runMetaPath(runId));
    assert.equal(meta.id, runId);
    assert.equal(meta.status, "completed");
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
