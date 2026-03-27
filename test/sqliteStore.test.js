const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

let store;

function createStore() {
  const { SqliteStore } = require("../src/storage/sqliteStore");
  return new SqliteStore(":memory:");
}

describe("SqliteStore", () => {
  beforeEach(() => {
    store = createStore();
  });

  afterEach(() => {
    store.close();
  });

  // ── Runs ──

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
    run1.createdAt = "2024-01-01T00:00:00.000Z";
    await store.saveRun(run1);

    const run2 = await store.createRunRecord({ topic: "second", title: "B", rounds: 2, settings: {} });
    run2.metadata = { status: "running" };
    run2.createdAt = "2024-06-01T00:00:00.000Z";
    await store.saveRun(run2);

    const result = await store.listRuns();
    assert.equal(result.runs.length, 2);
    assert.equal(result.total, 2);
    assert.equal(result.runs[0].topic, "second");
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

  it("deleteRun removes run and related data", async () => {
    const run = await store.createRunRecord({ topic: "del", title: "D", rounds: 2, settings: {} });
    run.metadata = { status: "completed" };
    await store.saveRun(run);

    await store.saveAnnotations(run.id, { runId: run.id, annotations: [{ text: "note" }] });
    await store.deleteRun(run.id);

    await assert.rejects(() => store.loadRun(run.id), (err) => err.statusCode === 404);
    const ann = await store.loadAnnotations(run.id);
    assert.deepEqual(ann.annotations, []);
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
  });

  it("saveRun preserves userId", async () => {
    const run = await store.createRunRecord({ topic: "auth", title: "A", rounds: 2, settings: {}, userId: "user-abc" });
    run.metadata = { status: "running" };
    await store.saveRun(run);

    const result = await store.listRuns();
    assert.equal(result.runs[0].userId, "user-abc");
  });

  it("saveRun preserves branchedFrom", async () => {
    const run = await store.createRunRecord({ topic: "branch", title: "B", rounds: 2, settings: {} });
    run.metadata = { status: "running" };
    run.branchedFrom = { runId: "run-source", round: 2 };
    await store.saveRun(run);

    const result = await store.listRuns();
    assert.deepEqual(result.runs[0].branchedFrom, { runId: "run-source", round: 2 });
  });

  // ── Agents ──

  it("createAgent and loadAgent round-trip", async () => {
    await store.createAgent("test-agent", {
      identity: "# Test Agent",
      system: "You are a test agent.",
      memory: "# Memory"
    });

    const agent = await store.loadAgent("test-agent");
    assert.equal(agent.agentId, "test-agent");
    assert.equal(agent.identity, "# Test Agent");
    assert.equal(agent.system, "You are a test agent.");
    assert.equal(agent.memory, "# Memory");
    assert.deepEqual(agent.config, {});
  });

  it("loadAgent throws 500 for missing agent", async () => {
    await assert.rejects(() => store.loadAgent("nonexistent"), (err) => {
      assert.equal(err.statusCode, 500);
      return true;
    });
  });

  it("listAgents returns agent IDs sorted", async () => {
    await store.createAgent("beta", { identity: "", system: "", memory: "" });
    await store.createAgent("alpha", { identity: "", system: "", memory: "" });

    const ids = await store.listAgents();
    assert.deepEqual(ids, ["alpha", "beta"]);
  });

  it("readAgentMemory and writeAgentMemory round-trip", async () => {
    await store.createAgent("mem-agent", { identity: "", system: "", memory: "initial" });

    const mem = await store.readAgentMemory("mem-agent");
    assert.equal(mem, "initial");

    await store.writeAgentMemory("mem-agent", "updated memory");
    const updated = await store.readAgentMemory("mem-agent");
    assert.equal(updated, "updated memory");
  });

  it("saveAgentConfig and loadAgentConfig round-trip", async () => {
    await store.createAgent("cfg-agent", { identity: "", system: "", memory: "" });

    await store.saveAgentConfig("cfg-agent", { model: "gpt-4", temperature: 0.5 });
    const cfg = await store.loadAgentConfig("cfg-agent");
    assert.deepEqual(cfg, { model: "gpt-4", temperature: 0.5 });
  });

  it("loadAgentConfig returns empty object for missing agent", async () => {
    const cfg = await store.loadAgentConfig("nonexistent");
    assert.deepEqual(cfg, {});
  });

  // ── Agent Sessions ──

  it("appendAgentSessionEntry creates and appends", async () => {
    await store.createAgent("sess-agent", { identity: "", system: "", memory: "" });

    await store.appendAgentSessionEntry("sess-agent", "run-1", { role: "assistant", content: "hello" });
    await store.appendAgentSessionEntry("sess-agent", "run-1", { role: "assistant", content: "world" });

    const count = await store.countAgentSessions("sess-agent");
    assert.equal(count, 1); // one session (agent_id + run_id combo)
  });

  // ── Annotations ──

  it("loadAnnotations returns empty for missing run", async () => {
    const ann = await store.loadAnnotations("run-missing");
    assert.deepEqual(ann, { runId: "run-missing", annotations: [] });
  });

  it("saveAnnotations and loadAnnotations round-trip", async () => {
    const data = { runId: "run-1", annotations: [{ text: "note", round: 1 }] };
    await store.saveAnnotations("run-1", data);

    const loaded = await store.loadAnnotations("run-1");
    assert.deepEqual(loaded, data);
  });

  // ── Templates ──

  it("saveTemplate and loadTemplate round-trip", async () => {
    const tmpl = await store.saveTemplate({ name: "My Template", topic: "test", rounds: 4 });
    assert.ok(tmpl.id.startsWith("tmpl-"));

    const loaded = await store.loadTemplate(tmpl.id);
    assert.equal(loaded.name, "My Template");
    assert.equal(loaded.topic, "test");
    assert.equal(loaded.rounds, 4);
  });

  it("listTemplates returns all templates", async () => {
    await store.saveTemplate({ name: "T1" });
    await store.saveTemplate({ name: "T2" });

    const list = await store.listTemplates();
    assert.equal(list.length, 2);
  });

  it("deleteTemplate removes template", async () => {
    const tmpl = await store.saveTemplate({ name: "ToDelete" });
    await store.deleteTemplate(tmpl.id);

    await assert.rejects(() => store.loadTemplate(tmpl.id), (err) => err.statusCode === 404);
  });

  // ── Embeddings ──

  it("saveMemoryEmbeddings and loadMemoryEmbeddings round-trip", async () => {
    const data = { chunks: [{ text: "hello", embedding: [0.1, 0.2] }] };
    await store.saveMemoryEmbeddings("agent-1", data);

    const loaded = await store.loadMemoryEmbeddings("agent-1");
    assert.deepEqual(loaded, data);
  });

  it("loadMemoryEmbeddings returns null for missing agent", async () => {
    const result = await store.loadMemoryEmbeddings("nonexistent");
    assert.equal(result, null);
  });

  // ── Snapshots ──

  it("saveSnapshot and getSnapshot round-trip", async () => {
    await store.createAgent("snap-agent", { identity: "# A", system: "sys", memory: "mem" });

    const snapshot = {
      id: "snap-2024-01-01",
      agentId: "snap-agent",
      label: "test",
      createdAt: new Date().toISOString(),
      memory: "mem",
      identity: "# A",
      system: "sys",
      config: {}
    };
    await store.saveSnapshot("snap-agent", snapshot);

    const loaded = await store.getSnapshot("snap-agent", "snap-2024-01-01");
    assert.equal(loaded.id, "snap-2024-01-01");
    assert.equal(loaded.memory, "mem");
  });

  it("listSnapshotsMeta returns snapshots sorted newest first", async () => {
    await store.createAgent("snap-agent2", { identity: "", system: "", memory: "" });

    await store.saveSnapshot("snap-agent2", {
      id: "snap-old", agentId: "snap-agent2", label: "old",
      createdAt: "2024-01-01T00:00:00.000Z", memory: "", identity: "", system: "", config: {}
    });
    await store.saveSnapshot("snap-agent2", {
      id: "snap-new", agentId: "snap-agent2", label: "new",
      createdAt: "2024-06-01T00:00:00.000Z", memory: "", identity: "", system: "", config: {}
    });

    const list = await store.listSnapshotsMeta("snap-agent2");
    assert.equal(list.length, 2);
    assert.equal(list[0].id, "snap-new");
  });

  it("deleteSnapshot removes snapshot", async () => {
    await store.createAgent("snap-agent3", { identity: "", system: "", memory: "" });
    await store.saveSnapshot("snap-agent3", {
      id: "snap-del", agentId: "snap-agent3", label: null,
      createdAt: new Date().toISOString(), memory: "", identity: "", system: "", config: {}
    });

    await store.deleteSnapshot("snap-agent3", "snap-del");
    await assert.rejects(() => store.getSnapshot("snap-agent3", "snap-del"), (err) => err.statusCode === 404);
  });

  // ── Users ──

  it("createUser returns user with id and apiKey", async () => {
    const user = await store.createUser({ name: "Alice" });
    assert.ok(user.id.startsWith("user-"));
    assert.ok(user.apiKey.startsWith("noia-"));
    assert.equal(user.name, "Alice");
  });

  it("listUsers returns created users", async () => {
    await store.createUser({ name: "Alice" });
    await store.createUser({ name: "Bob" });
    const users = await store.listUsers();
    assert.equal(users.length, 2);
  });

  it("loadUser returns user by ID", async () => {
    const created = await store.createUser({ name: "Charlie" });
    const loaded = await store.loadUser(created.id);
    assert.equal(loaded.id, created.id);
    assert.equal(loaded.name, "Charlie");
  });

  it("loadUser throws 404 for missing user", async () => {
    await assert.rejects(() => store.loadUser("user-nope"), (err) => err.statusCode === 404);
  });

  it("deleteUser removes user", async () => {
    const user = await store.createUser({ name: "Del" });
    await store.deleteUser(user.id);
    const users = await store.listUsers();
    assert.equal(users.length, 0);
  });

  // ── Documents ──

  it("saveDocument and loadDocument round-trip", async () => {
    const doc = { id: "doc-1", title: "Paper", text: "content", createdAt: new Date().toISOString() };
    await store.saveDocument("doc-1", doc);

    const loaded = await store.loadDocument("doc-1");
    assert.equal(loaded.title, "Paper");
  });

  it("listDocuments returns all documents", async () => {
    await store.saveDocument("doc-a", { id: "doc-a", createdAt: new Date().toISOString() });
    await store.saveDocument("doc-b", { id: "doc-b", createdAt: new Date().toISOString() });

    const list = await store.listDocuments();
    assert.equal(list.length, 2);
  });

  it("deleteDocument removes document", async () => {
    await store.saveDocument("doc-del", { id: "doc-del", createdAt: new Date().toISOString() });
    await store.deleteDocument("doc-del");

    await assert.rejects(() => store.loadDocument("doc-del"), (err) => err.statusCode === 404);
  });

  // ── Branching ──

  it("cloneRunUpToRound creates branched run", async () => {
    const source = await store.createRunRecord({ topic: "original", title: "Orig", rounds: 4, settings: {} });
    source.metadata = { status: "completed" };
    source.roundMessages = [
      { round: 1, messages: ["a"] },
      { round: 2, messages: ["b"] },
      { round: 3, messages: ["c"] }
    ];
    source._researchContext = "some context";
    await store.saveRun(source);

    const branched = await store.cloneRunUpToRound(source.id, 2);
    assert.ok(branched.id !== source.id);
    assert.equal(branched.topic, "original");
    assert.equal(branched.roundMessages.length, 2);
    assert.deepEqual(branched.branchedFrom, { runId: source.id, round: 2 });
    assert.equal(branched._researchContext, "some context");
  });

  // ── Utility no-ops ──

  it("readText returns fallback", async () => {
    const result = await store.readText("/any/path", "default");
    assert.equal(result, "default");
  });

  it("readJson returns fallback", async () => {
    const result = await store.readJson("/any/path", { empty: true });
    assert.deepEqual(result, { empty: true });
  });

  it("runPath and runMetaPath return empty string", () => {
    assert.equal(store.runPath(), "");
    assert.equal(store.runMetaPath(), "");
  });

  it("migrateMetaFiles is a no-op", async () => {
    await store.migrateMetaFiles(); // should not throw
  });

  // ── Template ownership ──

  it("saveTemplate stores userId and shared flag", async () => {
    const tmpl = await store.saveTemplate({ name: "T1", topic: "x", userId: "user-1", shared: true });
    const loaded = await store.loadTemplate(tmpl.id);
    assert.equal(loaded.userId, "user-1");
    assert.equal(loaded.shared, true);
  });

  it("listTemplates with userId shows own + shared + ownerless", async () => {
    await store.saveTemplate({ name: "Own", topic: "x", userId: "user-1" });
    await store.saveTemplate({ name: "Shared", topic: "x", userId: "user-2", shared: true });
    await store.saveTemplate({ name: "Other", topic: "x", userId: "user-2" });
    await store.saveTemplate({ name: "Legacy", topic: "x" });

    const visible = await store.listTemplates({ userId: "user-1" });
    const names = visible.map((t) => t.name).sort();
    assert.deepStrictEqual(names, ["Legacy", "Own", "Shared"]);
  });

  it("updateTemplate updates shared flag", async () => {
    const tmpl = await store.saveTemplate({ name: "T", topic: "x", userId: "user-1" });
    const loaded = await store.loadTemplate(tmpl.id);
    loaded.shared = true;
    await store.updateTemplate(tmpl.id, loaded);
    const updated = await store.loadTemplate(tmpl.id);
    assert.equal(updated.shared, true);
  });

  // ── Document ownership ──

  it("listDocuments with userId shows own + ownerless", async () => {
    await store.saveDocument("doc-1", { id: "doc-1", userId: "user-1", createdAt: new Date().toISOString() });
    await store.saveDocument("doc-2", { id: "doc-2", userId: "user-2", createdAt: new Date().toISOString() });
    await store.saveDocument("doc-3", { id: "doc-3", createdAt: new Date().toISOString() });

    const visible = await store.listDocuments({ userId: "user-1" });
    const ids = visible.map((d) => d.id).sort();
    assert.deepStrictEqual(ids, ["doc-1", "doc-3"]);
  });
});
