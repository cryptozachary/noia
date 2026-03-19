const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

let tmpDir;
let store;

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "noia-prune-test-"));
  await fs.mkdir(path.join(tmpDir, "runs"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, "agents"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, "exports"), { recursive: true });

  const { FileStore } = require("../src/storage/fileStore");
  store = new FileStore(tmpDir);
}

async function seedAgent(agentId, sectionCount) {
  const agentDir = path.join(tmpDir, "agents", agentId);
  await fs.mkdir(path.join(agentDir, "sessions"), { recursive: true });
  await fs.mkdir(path.join(agentDir, "snapshots"), { recursive: true });
  await fs.writeFile(path.join(agentDir, "identity.md"), "# Test Agent\n", "utf8");
  await fs.writeFile(path.join(agentDir, "system.md"), "You are a test agent.\n", "utf8");

  // Build memory with a preamble and N sections
  const parts = ["# Memory\n\n- Base memory line."];
  for (let i = 1; i <= sectionCount; i++) {
    parts.push(`## Session: run-${i}\nLearned about topic ${i}. Key insight ${i}.`);
  }
  await fs.writeFile(path.join(agentDir, "memory.md"), parts.join("\n\n") + "\n", "utf8");
}

async function cleanup() {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
}

function createMockLLM(summaryText) {
  return {
    generate: async () => ({
      text: summaryText || "Condensed summary of older sessions: key themes and findings.",
      usage: { input_tokens: 50, output_tokens: 30, total_tokens: 80 }
    })
  };
}

describe("MemoryPruner", () => {
  beforeEach(async () => {
    await setup();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns pruned=false when below threshold", async () => {
    await seedAgent("test-agent", 10);
    const { MemoryPruner } = require("../src/services/memoryPruner");
    const pruner = new MemoryPruner({ store, llmService: createMockLLM() });

    const result = await pruner.pruneAgentMemory("test-agent", { maxSections: 20 });
    assert.equal(result.pruned, false);
    assert.equal(result.reason, "below threshold");
  });

  it("prunes old sections and keeps recent ones", async () => {
    await seedAgent("test-agent", 35);
    const { MemoryPruner } = require("../src/services/memoryPruner");
    const pruner = new MemoryPruner({ store, llmService: createMockLLM() });

    const result = await pruner.pruneAgentMemory("test-agent", { maxSections: 20, keepRecent: 5 });
    assert.equal(result.pruned, true);
    assert.equal(result.beforeSections, 36); // 35 sections + 1 preamble
    assert.equal(result.summarizedCount, 30); // 35 - 5 = 30 old sections

    // Verify the new memory has correct structure
    const newMemory = await store.readAgentMemory("test-agent");
    assert.ok(newMemory.includes("# Memory"), "Should preserve preamble");
    assert.ok(newMemory.includes("## Summarized History"), "Should have summary section");
    assert.ok(newMemory.includes("## Session: run-35"), "Should keep most recent session");
    assert.ok(newMemory.includes("## Session: run-31"), "Should keep 5th most recent session");
    assert.ok(!newMemory.includes("## Session: run-1"), "Should not have oldest session");
  });

  it("preserves preamble before first ## heading", async () => {
    await seedAgent("test-agent", 25);
    const { MemoryPruner } = require("../src/services/memoryPruner");
    const pruner = new MemoryPruner({ store, llmService: createMockLLM() });

    const result = await pruner.pruneAgentMemory("test-agent", { maxSections: 20, keepRecent: 5 });
    assert.equal(result.pruned, true);

    const newMemory = await store.readAgentMemory("test-agent");
    assert.ok(newMemory.includes("Base memory line"), "Should preserve preamble content");
  });

  it("dry run returns stats without modifying memory", async () => {
    await seedAgent("test-agent", 30);
    const { MemoryPruner } = require("../src/services/memoryPruner");
    const pruner = new MemoryPruner({ store, llmService: createMockLLM() });

    const originalMemory = await store.readAgentMemory("test-agent");
    const result = await pruner.pruneAgentMemory("test-agent", { maxSections: 20, keepRecent: 5, dryRun: true });

    assert.equal(result.pruned, false);
    assert.equal(result.dryRun, true);
    assert.equal(result.wouldSummarize, 25); // 30 - 5 = 25

    const afterMemory = await store.readAgentMemory("test-agent");
    assert.equal(afterMemory, originalMemory, "Memory should not be modified in dry run");
  });

  it("shouldAutoPrune returns true when above threshold", async () => {
    await seedAgent("test-agent", 35);
    const { MemoryPruner } = require("../src/services/memoryPruner");
    const pruner = new MemoryPruner({ store, llmService: createMockLLM() });

    assert.ok(await pruner.shouldAutoPrune("test-agent", 30));
  });

  it("shouldAutoPrune returns false when below threshold", async () => {
    await seedAgent("test-agent", 10);
    const { MemoryPruner } = require("../src/services/memoryPruner");
    const pruner = new MemoryPruner({ store, llmService: createMockLLM() });

    assert.ok(!(await pruner.shouldAutoPrune("test-agent", 30)));
  });

  it("creates snapshot before pruning when snapshotService available", async () => {
    await seedAgent("test-agent", 25);
    const { MemoryPruner } = require("../src/services/memoryPruner");
    const { SnapshotService } = require("../src/services/snapshotService");
    const snapshotService = new SnapshotService(store);
    const pruner = new MemoryPruner({ store, llmService: createMockLLM(), snapshotService });

    await pruner.pruneAgentMemory("test-agent", { maxSections: 20, keepRecent: 5 });

    const snapshots = await snapshotService.listSnapshots("test-agent");
    const preSnap = snapshots.find((s) => s.label === "pre-prune");
    assert.ok(preSnap, "Should have created pre-prune snapshot");
  });
});
