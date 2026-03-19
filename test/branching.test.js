const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");
const { FileStore } = require("../src/storage/fileStore");

describe("Discussion Branching", () => {
  let store;
  let tmpDir;

  beforeEach(async () => {
    tmpDir = path.join(__dirname, `tmp-branch-${Date.now()}`);
    await fs.mkdir(path.join(tmpDir, "runs"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "agents"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "exports"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "topics"), { recursive: true });
    store = new FileStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("cloneRunUpToRound creates new run with truncated rounds", async () => {
    const original = await store.createRunRecord({ topic: "Test topic", title: "Test", rounds: 4, settings: {} });
    original.roundMessages = [
      { round: 1, stage: "initial-positions", messages: [{ agentId: "a1", content: "R1" }] },
      { round: 2, stage: "cross-critique", messages: [{ agentId: "a1", content: "R2" }] },
      { round: 3, stage: "convergence", messages: [{ agentId: "a1", content: "R3" }] }
    ];
    await store.saveRun(original);

    const cloned = await store.cloneRunUpToRound(original.id, 2);
    assert.notStrictEqual(cloned.id, original.id);
    assert.strictEqual(cloned.roundMessages.length, 2);
    assert.strictEqual(cloned.roundMessages[0].round, 1);
    assert.strictEqual(cloned.roundMessages[1].round, 2);
  });

  it("cloned run has branchedFrom set", async () => {
    const original = await store.createRunRecord({ topic: "Test", title: "Test", rounds: 3, settings: {} });
    original.roundMessages = [
      { round: 1, stage: "initial-positions", messages: [] }
    ];
    await store.saveRun(original);

    const cloned = await store.cloneRunUpToRound(original.id, 1);
    assert.deepStrictEqual(cloned.branchedFrom, { runId: original.id, round: 1 });
  });

  it("cloned run title includes branch indicator", async () => {
    const original = await store.createRunRecord({ topic: "Test", title: "My Discussion", rounds: 3, settings: {} });
    original.roundMessages = [{ round: 1, stage: "initial-positions", messages: [] }];
    await store.saveRun(original);

    const cloned = await store.cloneRunUpToRound(original.id, 1);
    assert.ok(cloned.title.includes("branch"));
  });

  it("listRuns includes branchedFrom when present", async () => {
    const original = await store.createRunRecord({ topic: "Test", title: "Original", rounds: 3, settings: {} });
    original.roundMessages = [{ round: 1, stage: "initial-positions", messages: [] }];
    await store.saveRun(original);

    const cloned = await store.cloneRunUpToRound(original.id, 1);
    cloned.metadata = { status: "completed" };
    await store.saveRun(cloned);

    const result = await store.listRuns();
    const branchedRun = result.runs.find((r) => r.id === cloned.id);
    assert.ok(branchedRun);
    assert.ok(branchedRun.branchedFrom);
    assert.strictEqual(branchedRun.branchedFrom.runId, original.id);
  });
});
