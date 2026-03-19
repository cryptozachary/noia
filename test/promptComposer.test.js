const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  composeScientistPrompt,
  composeCoordinatorFinalPrompt
} = require("../src/agents/promptComposer");

describe("composeScientistPrompt", () => {
  it("includes topic, round, stage, and agent role", () => {
    const result = composeScientistPrompt({
      agentId: "research-synthesizer",
      topic: "battery tech",
      roundNumber: 1,
      stage: "initial-positions",
      peerMessages: []
    });
    assert.ok(result.includes("battery tech"));
    assert.ok(result.includes("Round: 1"));
    assert.ok(result.includes("initial-positions"));
    assert.ok(result.includes("Research Synthesizer"));
  });

  it("includes initial-positions instruction", () => {
    const result = composeScientistPrompt({
      agentId: "research-synthesizer",
      topic: "x",
      roundNumber: 1,
      stage: "initial-positions",
      peerMessages: []
    });
    assert.ok(result.includes("initial analysis"));
  });

  it("includes cross-critique instruction", () => {
    const result = composeScientistPrompt({
      agentId: "skeptical-reviewer",
      topic: "x",
      roundNumber: 2,
      stage: "cross-critique",
      peerMessages: []
    });
    assert.ok(result.includes("critique peer ideas"));
  });

  it("includes convergence instruction", () => {
    const result = composeScientistPrompt({
      agentId: "innovation-strategist",
      topic: "x",
      roundNumber: 3,
      stage: "convergence",
      peerMessages: []
    });
    assert.ok(result.includes("top 3"));
  });

  it("includes required output structure", () => {
    const result = composeScientistPrompt({
      agentId: "research-synthesizer",
      topic: "x",
      roundNumber: 1,
      stage: "initial-positions",
      peerMessages: []
    });
    assert.ok(result.includes("Position:"));
    assert.ok(result.includes("Revised View:"));
  });

  it("includes peer messages when provided", () => {
    const result = composeScientistPrompt({
      agentId: "research-synthesizer",
      topic: "x",
      roundNumber: 2,
      stage: "cross-critique",
      peerMessages: [{ agentName: "Skeptic", round: 1, content: "I disagree" }]
    });
    assert.ok(result.includes("Skeptic"));
    assert.ok(result.includes("I disagree"));
  });

  it("includes research context when provided", () => {
    const result = composeScientistPrompt({
      agentId: "research-synthesizer",
      topic: "x",
      roundNumber: 1,
      stage: "initial-positions",
      peerMessages: [],
      researchContext: "[1] Some Paper\n    URL: https://example.com"
    });
    assert.ok(result.includes("[1] Some Paper"));
  });

  it("omits research context when empty", () => {
    const result = composeScientistPrompt({
      agentId: "research-synthesizer",
      topic: "x",
      roundNumber: 1,
      stage: "initial-positions",
      peerMessages: [],
      researchContext: ""
    });
    assert.ok(!result.includes("Research Context"));
  });
});

describe("composeCoordinatorFinalPrompt", () => {
  it("includes all 10 required section headings", () => {
    const result = composeCoordinatorFinalPrompt({
      topic: "test",
      discussionText: "transcript here",
      isMedicalTopic: false
    });
    assert.ok(result.includes("1. Topic"));
    assert.ok(result.includes("10. Safety Note / Disclaimer"));
  });

  it("includes medical instruction for medical topics", () => {
    const result = composeCoordinatorFinalPrompt({
      topic: "cancer treatment",
      discussionText: "transcript",
      isMedicalTopic: true
    });
    assert.ok(result.includes("not medical advice"));
  });

  it("includes research context when provided", () => {
    const result = composeCoordinatorFinalPrompt({
      topic: "test",
      discussionText: "transcript",
      isMedicalTopic: false,
      researchContext: "[1] Research paper"
    });
    assert.ok(result.includes("[1] Research paper"));
  });

  it("includes discussion transcript", () => {
    const result = composeCoordinatorFinalPrompt({
      topic: "test",
      discussionText: "Round 1 data here",
      isMedicalTopic: false
    });
    assert.ok(result.includes("Round 1 data here"));
  });
});
