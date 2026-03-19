const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const { FileStore } = require("../src/storage/fileStore");

describe("Annotations", () => {
  let store;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = path.join(__dirname, `tmp-ann-${Date.now()}`);
    await fs.mkdir(path.join(tmpDir, "runs"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "agents"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "exports"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "topics"), { recursive: true });
    store = new FileStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loadAnnotations returns empty for non-existent run", async () => {
    const data = await store.loadAnnotations("run-nonexistent");
    assert.deepStrictEqual(data.annotations, []);
  });

  it("saveAnnotations and loadAnnotations round-trip", async () => {
    const runId = "run-test-123";
    const annotations = {
      runId,
      annotations: [
        { id: "ann-001", round: 1, agentId: "research-synthesizer", text: "Good point", timestamp: new Date().toISOString() }
      ]
    };
    await store.saveAnnotations(runId, annotations);
    const loaded = await store.loadAnnotations(runId);
    assert.strictEqual(loaded.annotations.length, 1);
    assert.strictEqual(loaded.annotations[0].text, "Good point");
  });

  it("deleteAnnotationsForRun removes the file", async () => {
    const runId = "run-test-456";
    await store.saveAnnotations(runId, { runId, annotations: [{ id: "ann-002", text: "note" }] });
    await store.deleteAnnotationsForRun(runId);
    const data = await store.loadAnnotations(runId);
    assert.deepStrictEqual(data.annotations, []);
  });
});
