const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { collectPeerMessages } = require("../src/orchestrator/discussionOrchestrator");
const { formatPeerContext } = require("../src/agents/promptComposer");

describe("collectPeerMessages with compression", () => {
  const roundMessages = [
    {
      round: 1,
      messages: [
        { agentId: "a1", agentName: "Agent A", content: "Round 1 from A" },
        { agentId: "a2", agentName: "Agent B", content: "Round 1 from B" }
      ]
    },
    {
      round: 2,
      messages: [
        { agentId: "a1", agentName: "Agent A", content: "Round 2 from A" },
        { agentId: "a2", agentName: "Agent B", content: "Round 2 from B" }
      ]
    },
    {
      round: 3,
      messages: [
        { agentId: "a1", agentName: "Agent A", content: "Round 3 from A" },
        { agentId: "a2", agentName: "Agent B", content: "Round 3 from B" }
      ]
    }
  ];

  it("returns summary + recent when summary available", () => {
    const summaries = { 2: "Summary of rounds 1-2: agents discussed X and Y." };
    const result = collectPeerMessages(roundMessages, "a1", summaries);
    assert.strictEqual(result.summary, summaries[2]);
    // Recent messages should only be from round 3 (the latest)
    assert.ok(result.recentMessages.every((m) => m.round === 3));
    // Should not include a1's own messages
    assert.ok(result.recentMessages.every((m) => m.agentName !== "Agent A"));
  });

  it("falls back to raw messages without summaries", () => {
    const result = collectPeerMessages(roundMessages, "a1", {});
    assert.strictEqual(result.summary, null);
    assert.ok(result.recentMessages.length > 0);
    assert.ok(result.recentMessages.length <= 6);
  });

  it("falls back to raw messages when summaries undefined", () => {
    const result = collectPeerMessages(roundMessages, "a1");
    assert.strictEqual(result.summary, null);
    assert.ok(result.recentMessages.length > 0);
  });

  it("excludes current agent from recent messages", () => {
    const summaries = { 2: "Summary text" };
    const result = collectPeerMessages(roundMessages, "a2", summaries);
    assert.ok(result.recentMessages.every((m) => m.agentName === "Agent A"));
  });
});

describe("formatPeerContext", () => {
  it("includes summary and recent messages", () => {
    const ctx = {
      summary: "Prior rounds discussed battery chemistry.",
      recentMessages: [{ agentName: "Agent B", round: 3, content: "Latest thoughts." }]
    };
    const output = formatPeerContext(ctx);
    assert.ok(output.includes("Summary of prior discussion rounds:"));
    assert.ok(output.includes("battery chemistry"));
    assert.ok(output.includes("Recent peer messages:"));
    assert.ok(output.includes("Agent B"));
  });

  it("handles summary-only case", () => {
    const ctx = { summary: "Summary text only.", recentMessages: [] };
    const output = formatPeerContext(ctx);
    assert.ok(output.includes("Summary of prior discussion rounds:"));
    assert.ok(!output.includes("Recent peer messages:"));
  });

  it("handles no-context case", () => {
    const ctx = { summary: null, recentMessages: [] };
    const output = formatPeerContext(ctx);
    assert.strictEqual(output, "No peer messages yet.");
  });
});
