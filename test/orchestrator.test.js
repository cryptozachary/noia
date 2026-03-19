const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DiscussionOrchestrator } = require("../src/orchestrator/discussionOrchestrator");

class MockLLMService {
  constructor(responses = []) {
    this._responses = responses;
    this._i = 0;
    this.calls = [];
  }

  async generate({ systemPrompt, userPrompt, override }) {
    this.calls.push({ systemPrompt, userPrompt, override });
    const response = this._responses[this._i] || {
      text: "Position: Mock\n\nSupporting Reasoning: Mock\n\nConfidence Level: Medium\n\nClaim Classification: Inferred\n\nMain Uncertainty: None\n\nCritique of Others: None\n\nRevised View: Same",
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 }
    };
    this._i++;
    return response;
  }
}

class MockStore {
  constructor() {
    this.runs = {};
    this.agents = {};
    this.sessions = [];
    this.exports = [];
  }

  async createRunRecord({ topic, title, rounds, settings }) {
    const run = {
      id: "test-run-001",
      title,
      topic,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      settings,
      rounds,
      roundMessages: [],
      finalReport: "",
      metadata: { status: "running" }
    };
    return run;
  }

  async saveRun(run) { this.runs[run.id] = run; }
  async loadRun(runId) { return this.runs[runId]; }

  async loadAgent(agentId) {
    return {
      agentId,
      identity: `# ${agentId}`,
      system: `You are the ${agentId} agent.`,
      memory: "# Memory",
      config: {}
    };
  }

  async appendAgentSessionEntry(agentId, runId, entry) {
    this.sessions.push({ agentId, runId, entry });
  }

  async saveExport(runId, text) {
    this.exports.push({ runId, text });
  }

  async readAgentMemory() { return "# Memory"; }
  async writeAgentMemory() {}
  async listAgents() { return []; }
}

describe("DiscussionOrchestrator", () => {
  it("completes a 2-round discussion with mock service", async () => {
    const store = new MockStore();
    const llmService = new MockLLMService();
    const orchestrator = new DiscussionOrchestrator({
      store,
      openaiService: llmService,
      defaultModel: "test-model"
    });

    const emitter = new EventEmitter();
    const events = [];
    emitter.on("round-start", (d) => events.push({ type: "round-start", ...d }));
    emitter.on("agent-response", (d) => events.push({ type: "agent-response", ...d }));
    emitter.on("round-complete", (d) => events.push({ type: "round-complete", ...d }));
    emitter.on("final-report", (d) => events.push({ type: "final-report", ...d }));
    emitter.on("run-complete", (d) => events.push({ type: "run-complete", ...d }));

    const run = await orchestrator.runDiscussion({
      topic: "test topic",
      title: "Test",
      rounds: 2,
      settings: {},
      emitter
    });

    assert.equal(run.metadata.status, "completed");
    assert.ok(run.finalReport.length > 0);
    assert.ok(events.some((e) => e.type === "round-start"));
    assert.ok(events.some((e) => e.type === "final-report"));
    assert.ok(events.some((e) => e.type === "run-complete"));
    // Should have called LLM: 3 scientists (round 1) + 1 coordinator (round 2 = final)
    assert.ok(llmService.calls.length >= 4);
  });

  it("respects cancellation between rounds", async () => {
    const store = new MockStore();
    const llmService = new MockLLMService();
    const orchestrator = new DiscussionOrchestrator({
      store,
      openaiService: llmService,
      defaultModel: "test-model"
    });

    let callCount = 0;
    const checkCancelled = () => {
      callCount++;
      return callCount > 1; // Cancel after first round check
    };

    const emitter = new EventEmitter();
    const run = await orchestrator.runDiscussion({
      topic: "cancel test",
      title: "Cancel",
      rounds: 4,
      settings: {},
      emitter,
      checkCancelled
    });

    assert.equal(run.metadata.status, "cancelled");
  });

  it("accumulates token usage", async () => {
    const store = new MockStore();
    const llmService = new MockLLMService();
    const orchestrator = new DiscussionOrchestrator({
      store,
      openaiService: llmService,
      defaultModel: "test-model"
    });

    const run = await orchestrator.runDiscussion({
      topic: "tokens test",
      title: "Tokens",
      rounds: 2,
      settings: {}
    });

    assert.ok(run.metadata.tokenUsage.total_tokens > 0);
    assert.ok(run.metadata.tokenUsage.input_tokens > 0);
    assert.ok(run.metadata.tokenUsage.output_tokens > 0);
  });
});
