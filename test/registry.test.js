const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// We need a fresh registry for each test, but the module caches state.
// We'll test the exported functions with awareness of shared state.
const {
  getAgent,
  getScientistAgentIds,
  addAgent,
  removeAgent,
  DEFAULT_AGENTS,
  reloadFromDisk
} = require("../src/agents/registry");

describe("registry", () => {
  // Store original state to restore
  const originalIds = DEFAULT_AGENTS.map((a) => a.id);

  it("getAgent returns built-in agents", () => {
    const agent = getAgent("research-synthesizer");
    assert.ok(agent);
    assert.equal(agent.name, "Research Synthesizer");
  });

  it("getAgent returns null for unknown agent", () => {
    assert.equal(getAgent("nonexistent-agent"), null);
  });

  it("getScientistAgentIds excludes coordinator", () => {
    const ids = getScientistAgentIds();
    assert.ok(ids.includes("research-synthesizer"));
    assert.ok(ids.includes("skeptical-reviewer"));
    assert.ok(ids.includes("innovation-strategist"));
    assert.ok(!ids.includes("coordinator"));
  });

  it("addAgent adds a new agent", () => {
    addAgent({ id: "test-agent-1", name: "Test Agent", shortName: "Test", purpose: "Testing", color: "#000" });
    const agent = getAgent("test-agent-1");
    assert.ok(agent);
    assert.equal(agent.name, "Test Agent");
    // Clean up
    removeAgent("test-agent-1");
  });

  it("addAgent updates existing agent", () => {
    addAgent({ id: "test-agent-2", name: "Original", shortName: "Orig", purpose: "Test", color: "#000" });
    addAgent({ id: "test-agent-2", name: "Updated", shortName: "Upd", purpose: "Test", color: "#000" });
    assert.equal(getAgent("test-agent-2").name, "Updated");
    removeAgent("test-agent-2");
  });

  it("removeAgent removes an agent", () => {
    addAgent({ id: "test-agent-3", name: "ToRemove", shortName: "Rem", purpose: "Test", color: "#000" });
    assert.ok(getAgent("test-agent-3"));
    removeAgent("test-agent-3");
    assert.equal(getAgent("test-agent-3"), null);
  });

  it("reloadFromDisk discovers new agents", () => {
    const before = getScientistAgentIds().length;
    reloadFromDisk(["research-synthesizer", "custom-discovery-test"]);
    const after = getScientistAgentIds().length;
    assert.ok(after > before);
    assert.ok(getAgent("custom-discovery-test"));
    // Clean up
    removeAgent("custom-discovery-test");
  });

  it("reloadFromDisk does not duplicate known agents", () => {
    const before = getScientistAgentIds().length;
    reloadFromDisk(originalIds);
    const after = getScientistAgentIds().length;
    assert.equal(after, before);
  });
});
