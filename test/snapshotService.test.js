const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

let tmpDir;
let store;
let snapshotService;

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "noia-snap-test-"));
  await fs.mkdir(path.join(tmpDir, "runs"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, "agents"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, "exports"), { recursive: true });

  const { FileStore } = require("../src/storage/fileStore");
  const { SnapshotService } = require("../src/services/snapshotService");
  store = new FileStore(tmpDir);
  snapshotService = new SnapshotService(store);
}

async function seedAgent(agentId) {
  const agentDir = path.join(tmpDir, "agents", agentId);
  await fs.mkdir(path.join(agentDir, "sessions"), { recursive: true });
  await fs.mkdir(path.join(agentDir, "snapshots"), { recursive: true });
  await fs.writeFile(path.join(agentDir, "identity.md"), "# Test Agent\n", "utf8");
  await fs.writeFile(path.join(agentDir, "system.md"), "You are a test agent.\n", "utf8");
  await fs.writeFile(path.join(agentDir, "memory.md"), "# Memory\n\n- Initial memory.\n", "utf8");
}

async function cleanup() {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
}

describe("SnapshotService", () => {
  beforeEach(async () => {
    await setup();
    await seedAgent("test-agent");
  });

  afterEach(async () => {
    await cleanup();
  });

  it("createSnapshot captures agent state", async () => {
    const snap = await snapshotService.createSnapshot("test-agent", { label: "manual" });
    assert.ok(snap.id.startsWith("snap-"));
    assert.equal(snap.agentId, "test-agent");
    assert.equal(snap.label, "manual");
    assert.equal(snap.memory, "# Memory\n\n- Initial memory.\n");
    assert.equal(snap.identity, "# Test Agent\n");
    assert.equal(snap.system, "You are a test agent.\n");
    assert.deepStrictEqual(snap.config, {});
  });

  it("listSnapshots returns sorted newest-first", async () => {
    await snapshotService.createSnapshot("test-agent", { label: "first" });
    // small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 15));
    await snapshotService.createSnapshot("test-agent", { label: "second" });

    const list = await snapshotService.listSnapshots("test-agent");
    assert.equal(list.length, 2);
    assert.equal(list[0].label, "second");
    assert.equal(list[1].label, "first");
  });

  it("getSnapshot returns full snapshot data", async () => {
    const created = await snapshotService.createSnapshot("test-agent", { label: "full" });
    const loaded = await snapshotService.getSnapshot("test-agent", created.id);
    assert.equal(loaded.id, created.id);
    assert.equal(loaded.memory, "# Memory\n\n- Initial memory.\n");
    assert.equal(loaded.identity, "# Test Agent\n");
  });

  it("getSnapshot throws 404 for missing snapshot", async () => {
    await assert.rejects(
      () => snapshotService.getSnapshot("test-agent", "snap-nonexistent"),
      (err) => err.statusCode === 404
    );
  });

  it("restoreSnapshot overwrites agent files and creates safety snapshot", async () => {
    // Create initial snapshot
    const snap = await snapshotService.createSnapshot("test-agent", { label: "original" });

    // Modify agent state
    await store.writeAgentMemory("test-agent", "# Memory\n\n- Modified memory.\n");
    await store.writeText(store.agentPath("test-agent", "identity.md"), "# Modified Agent\n");

    // Restore
    await snapshotService.restoreSnapshot("test-agent", snap.id);

    // Verify files restored
    const memory = await store.readAgentMemory("test-agent");
    assert.equal(memory, "# Memory\n\n- Initial memory.\n");
    const identity = await store.readText(store.agentPath("test-agent", "identity.md"));
    assert.equal(identity, "# Test Agent\n");

    // Verify safety snapshot was created (pre-restore label)
    const list = await snapshotService.listSnapshots("test-agent");
    const safetySnap = list.find((s) => s.label === "pre-restore");
    assert.ok(safetySnap, "Safety snapshot should exist");
  });

  it("pruneOldSnapshots keeps newest N", async () => {
    // Create 5 snapshots
    for (let i = 0; i < 5; i++) {
      await snapshotService.createSnapshot("test-agent", { label: `snap-${i}` });
      await new Promise((r) => setTimeout(r, 15));
    }

    const deleted = await snapshotService.pruneOldSnapshots("test-agent", 3);
    assert.equal(deleted, 2);

    const remaining = await snapshotService.listSnapshots("test-agent");
    assert.equal(remaining.length, 3);
    // Newest should survive
    assert.equal(remaining[0].label, "snap-4");
    assert.equal(remaining[1].label, "snap-3");
    assert.equal(remaining[2].label, "snap-2");
  });

  it("listSnapshots returns empty array for agent with no snapshots dir", async () => {
    await seedAgent("no-snaps-agent");
    // Remove snapshots dir
    await fs.rm(path.join(tmpDir, "agents", "no-snaps-agent", "snapshots"), { recursive: true, force: true });
    const list = await snapshotService.listSnapshots("no-snaps-agent");
    assert.deepStrictEqual(list, []);
  });

  it("handles agent with no config.json gracefully", async () => {
    // config.json doesn't exist for test-agent (never created)
    const snap = await snapshotService.createSnapshot("test-agent");
    assert.deepStrictEqual(snap.config, {});
  });
});
