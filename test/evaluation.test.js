const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeMetrics } = require("../src/services/graphBuilder");
const { parseJsonArray } = require("../src/services/claimExtractor");

describe("computeMetrics", () => {
  it("returns zeros for empty graph", () => {
    const metrics = computeMetrics({ nodes: [], edges: [] }, {});
    assert.strictEqual(metrics.consensusScore, 0);
    assert.strictEqual(metrics.evidenceDensity, 0);
    assert.strictEqual(metrics.totalClaims, 0);
    assert.strictEqual(metrics.totalEdges, 0);
  });

  it("computes consensus score from supports vs contradicts", () => {
    const nodes = [
      { id: "c1", type: "position", agentId: "a1", round: 1 },
      { id: "c2", type: "position", agentId: "a2", round: 1 },
      { id: "c3", type: "position", agentId: "a3", round: 1 }
    ];
    const edges = [
      { source: "c1", target: "c2", type: "supports" },
      { source: "c1", target: "c3", type: "supports" },
      { source: "c2", target: "c3", type: "contradicts" }
    ];
    const metrics = computeMetrics({ nodes, edges }, {});
    // 2 supports / (2 supports + 1 contradicts) = 0.67
    assert.strictEqual(metrics.consensusScore, 0.67);
    assert.strictEqual(metrics.totalClaims, 3);
    assert.strictEqual(metrics.totalEdges, 3);
  });

  it("computes evidence density", () => {
    const nodes = [
      { id: "c1", type: "evidence", agentId: "a1", round: 1 },
      { id: "c2", type: "position", agentId: "a1", round: 1 },
      { id: "c3", type: "evidence", agentId: "a2", round: 1 },
      { id: "c4", type: "objection", agentId: "a2", round: 1 }
    ];
    const metrics = computeMetrics({ nodes, edges: [] }, {});
    // 2 evidence / 4 total = 0.5
    assert.strictEqual(metrics.evidenceDensity, 0.5);
  });

  it("computes claim diversity across agents", () => {
    const nodes = [
      { id: "c1", type: "position", agentId: "a1", round: 1 },
      { id: "c2", type: "evidence", agentId: "a1", round: 1 },
      { id: "c3", type: "objection", agentId: "a1", round: 1 },
      { id: "c4", type: "proposal", agentId: "a1", round: 1 },
      { id: "c5", type: "position", agentId: "a2", round: 1 },
      { id: "c6", type: "evidence", agentId: "a2", round: 1 }
    ];
    const metrics = computeMetrics({ nodes, edges: [] }, {});
    // agent a1: 4 types, agent a2: 2 types => avg = 3, diversity = 3/4 = 0.75
    assert.strictEqual(metrics.claimDiversity, 0.75);
  });

  it("computes convergence rate with decreasing contradictions", () => {
    const nodes = [
      { id: "c1", type: "position", agentId: "a1", round: 1 },
      { id: "c2", type: "position", agentId: "a2", round: 1 },
      { id: "c3", type: "position", agentId: "a1", round: 2 },
      { id: "c4", type: "position", agentId: "a2", round: 2 }
    ];
    const edges = [
      { source: "c1", target: "c2", type: "contradicts" },
      { source: "c3", target: "c4", type: "supports" }
    ];
    const metrics = computeMetrics({ nodes, edges }, {});
    // Early (round 1): 1 contradiction, Late (round 2): 0 contradictions
    // convergenceRate = 1 - (0/1) = 1
    assert.strictEqual(metrics.convergenceRate, 1);
  });

  it("returns 0.5 consensus when no supports or contradicts", () => {
    const nodes = [
      { id: "c1", type: "position", agentId: "a1", round: 1 }
    ];
    const metrics = computeMetrics({ nodes, edges: [] }, {});
    assert.strictEqual(metrics.consensusScore, 0.5);
  });

  it("tracks claims by agent and round", () => {
    const nodes = [
      { id: "c1", type: "position", agentId: "a1", round: 1 },
      { id: "c2", type: "evidence", agentId: "a1", round: 2 },
      { id: "c3", type: "position", agentId: "a2", round: 1 }
    ];
    const metrics = computeMetrics({ nodes, edges: [] }, {});
    assert.deepStrictEqual(metrics.claimsByAgent, { a1: 2, a2: 1 });
    assert.deepStrictEqual(metrics.claimsByRound, { 1: 2, 2: 1 });
  });
});

describe("parseJsonArray", () => {
  it("parses valid JSON array", () => {
    const result = parseJsonArray('[{"text":"hello","type":"position"}]');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].text, "hello");
  });

  it("handles markdown code fences", () => {
    const result = parseJsonArray('```json\n[{"text":"a"}]\n```');
    assert.strictEqual(result.length, 1);
  });

  it("returns empty for null/empty input", () => {
    assert.deepStrictEqual(parseJsonArray(null), []);
    assert.deepStrictEqual(parseJsonArray(""), []);
  });

  it("returns empty for invalid JSON", () => {
    assert.deepStrictEqual(parseJsonArray("not json at all"), []);
  });

  it("returns empty for non-array JSON", () => {
    assert.deepStrictEqual(parseJsonArray('{"key": "value"}'), []);
  });
});
