const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateDiscussionRequest,
  ensureAgentResponseStructure,
  ensureFinalReportStructure
} = require("../src/services/outputValidator");

describe("validateDiscussionRequest", () => {
  it("returns valid payload with defaults", () => {
    const result = validateDiscussionRequest({ topic: "quantum computing" });
    assert.equal(result.topic, "quantum computing");
    assert.equal(result.rounds, 4);
    assert.equal(result.title, "quantum computing");
  });

  it("trims topic and title", () => {
    const result = validateDiscussionRequest({ topic: "  space  ", title: "  My Title  " });
    assert.equal(result.topic, "space");
    assert.equal(result.title, "My Title");
  });

  it("throws on empty topic", () => {
    assert.throws(() => validateDiscussionRequest({ topic: "" }), /Topic is required/);
  });

  it("throws on missing topic", () => {
    assert.throws(() => validateDiscussionRequest({}), /Topic is required/);
  });

  it("throws on rounds below 2", () => {
    assert.throws(() => validateDiscussionRequest({ topic: "x", rounds: 1 }), /Rounds must be/);
  });

  it("throws on rounds above 8", () => {
    assert.throws(() => validateDiscussionRequest({ topic: "x", rounds: 9 }), /Rounds must be/);
  });

  it("throws on non-integer rounds", () => {
    assert.throws(() => validateDiscussionRequest({ topic: "x", rounds: 3.5 }), /Rounds must be/);
  });

  it("accepts valid rounds", () => {
    const result = validateDiscussionRequest({ topic: "x", rounds: 6 });
    assert.equal(result.rounds, 6);
  });

  it("defaults title to first 72 chars of topic", () => {
    const long = "a".repeat(100);
    const result = validateDiscussionRequest({ topic: long });
    assert.equal(result.title.length, 72);
  });
});

describe("ensureAgentResponseStructure", () => {
  it("returns full fallback for empty input", () => {
    const result = ensureAgentResponseStructure("");
    assert.ok(result.includes("Position:"));
    assert.ok(result.includes("Revised View:"));
    assert.ok(result.includes("Not provided."));
  });

  it("returns source unchanged when all sections present", () => {
    const complete = [
      "Position: My position",
      "Supporting Reasoning: My reasoning",
      "Confidence Level: High",
      "Claim Classification: Established",
      "Main Uncertainty: None",
      "Critique of Others: Agree",
      "Revised View: Same"
    ].join("\n\n");
    assert.equal(ensureAgentResponseStructure(complete), complete);
  });

  it("appends missing sections", () => {
    const partial = "Position: Something\nSupporting Reasoning: Because";
    const result = ensureAgentResponseStructure(partial);
    assert.ok(result.includes("Position: Something"));
    assert.ok(result.includes("Confidence Level:"));
    assert.ok(result.includes("Not explicitly provided."));
  });
});

describe("ensureFinalReportStructure", () => {
  it("builds fallback for empty input", () => {
    const result = ensureFinalReportStructure("", "test topic");
    assert.ok(result.includes("1. Topic"));
    assert.ok(result.includes("test topic"));
    assert.ok(result.includes("10. Safety Note"));
  });

  it("returns complete report unchanged", () => {
    const complete = [
      "1. Topic\nTest",
      "2. Executive Summary\nSummary",
      "3. Known / Established Points\nPoints",
      "4. Most Promising Hypotheses\nHyp",
      "5. Major Objections / Risks\nRisks",
      "6. Proposed Experiments or Validation Steps\nExps",
      "7. Unresolved Disagreements\nDisagreements",
      "8. Confidence / Uncertainty Summary\nConf",
      "9. Suggested Next Research Directions\nDirs",
      "10. Safety Note / Disclaimer\nDisclaimer"
    ].join("\n\n");
    assert.equal(ensureFinalReportStructure(complete, "Test"), complete);
  });

  it("appends missing sections to partial report", () => {
    const partial = "1. Topic\nTest\n\n2. Executive Summary\nSummary";
    const result = ensureFinalReportStructure(partial, "Test");
    assert.ok(result.includes("1. Topic"));
    assert.ok(result.includes("3. Known / Established Points"));
    assert.ok(result.includes("Not provided."));
  });
});
