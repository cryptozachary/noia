const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const EventEmitter = require("node:events");

let tmpDir;
let store;

async function createTempStore() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "noia-retry-test-"));
  const dirs = ["runs", "agents", "exports", "topics", "templates"];
  for (const d of dirs) await fs.mkdir(path.join(tmpDir, d), { recursive: true });

  // Seed required agents
  const agentIds = ["research-synthesizer", "skeptical-reviewer", "innovation-strategist", "coordinator"];
  for (const id of agentIds) {
    const agentDir = path.join(tmpDir, "agents", id);
    await fs.mkdir(path.join(agentDir, "sessions"), { recursive: true });
    await fs.writeFile(path.join(agentDir, "identity.md"), `# ${id}\n`, "utf8");
    await fs.writeFile(path.join(agentDir, "system.md"), `You are ${id}.\n`, "utf8");
    await fs.writeFile(path.join(agentDir, "memory.md"), "# Memory\n", "utf8");
  }

  const { FileStore } = require("../src/storage/fileStore");
  return new FileStore(tmpDir);
}

async function cleanupTemp() {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
}

describe("isTransientError", () => {
  const { isTransientError } = require("../src/orchestrator/discussionOrchestrator");

  it("returns true for 429 status", () => {
    assert.ok(isTransientError({ statusCode: 429, message: "" }));
  });

  it("returns true for 500+ status", () => {
    assert.ok(isTransientError({ statusCode: 500, message: "" }));
    assert.ok(isTransientError({ status: 502, message: "" }));
    assert.ok(isTransientError({ status: 503, message: "" }));
  });

  it("returns true for timeout messages", () => {
    assert.ok(isTransientError({ message: "Request timed out (timeout)" }));
  });

  it("returns true for ECONNRESET error code", () => {
    assert.ok(isTransientError({ message: "", code: "ECONNRESET" }));
    assert.ok(isTransientError({ message: "", code: "ETIMEDOUT" }));
    assert.ok(isTransientError({ message: "", code: "ENOTFOUND" }));
  });

  it("returns true for rate limit messages", () => {
    assert.ok(isTransientError({ message: "Rate limit exceeded" }));
    assert.ok(isTransientError({ message: "rate_limit_error" }));
  });

  it("returns false for non-transient errors", () => {
    assert.ok(!isTransientError({ message: "Invalid API key", statusCode: 401 }));
    assert.ok(!isTransientError({ message: "Bad request", statusCode: 400 }));
    assert.ok(!isTransientError({ message: "Some random error" }));
  });
});

describe("Agent retry in orchestrator", () => {
  beforeEach(async () => {
    store = await createTempStore();
  });

  afterEach(async () => {
    await cleanupTemp();
  });

  it("retries on transient error then succeeds", async () => {
    let callCount = 0;
    const mockService = {
      generate: async () => {
        callCount++;
        if (callCount <= 3) {
          // First 3 calls fail (one per agent on first attempt)
          // but only the specific agent's call count matters
          const error = new Error("rate_limit_error");
          error.statusCode = 429;
          throw error;
        }
        return { text: "Position:\nTest response", usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } };
      }
    };

    const { DiscussionOrchestrator } = require("../src/orchestrator/discussionOrchestrator");
    const orch = new DiscussionOrchestrator({
      store,
      openaiService: mockService,
      defaultModel: "test-model",
      fullConfig: { agentRetries: 1, agentRetryDelayMs: 10 }
    });

    const emitter = new EventEmitter();
    emitter.setMaxListeners(30);
    const retryEvents = [];
    emitter.on("agent-retry", (d) => retryEvents.push(d));

    const run = await orch.runDiscussion({
      topic: "test retry",
      rounds: 2,
      settings: { autoMemory: false, streaming: false, contextCompression: false },
      emitter
    });

    assert.equal(run.metadata.status, "completed");
    // At least some retry events should have been emitted
    assert.ok(retryEvents.length > 0, "Should have emitted retry events");
    assert.equal(retryEvents[0].attempt, 1);
  });

  it("falls back immediately on non-transient error", async () => {
    // Every call throws a non-transient error
    const mockService = {
      generate: async () => {
        throw new Error("Invalid API key");
      }
    };

    const { DiscussionOrchestrator } = require("../src/orchestrator/discussionOrchestrator");
    const orch = new DiscussionOrchestrator({
      store,
      openaiService: mockService,
      defaultModel: "test-model",
      fullConfig: { agentRetries: 2, agentRetryDelayMs: 10 }
    });

    const emitter = new EventEmitter();
    emitter.setMaxListeners(30);
    const retryEvents = [];
    emitter.on("agent-retry", (d) => retryEvents.push(d));
    const responseEvents = [];
    emitter.on("agent-response", (d) => responseEvents.push(d));

    // This will fail at title generation too, but that's caught separately
    // All agent calls will fail with non-transient error
    try {
      await orch.runDiscussion({
        topic: "test no retry",
        rounds: 2,
        settings: { autoMemory: false, streaming: false, contextCompression: false },
        emitter
      });
    } catch {
      // The final-synthesis coordinator call also fails, which may throw
    }

    // No retry events for non-transient errors
    assert.equal(retryEvents.length, 0, "Should not retry non-transient errors");
    // Agent responses should have error fields
    const errorResponses = responseEvents.filter((r) => r.error);
    assert.ok(errorResponses.length > 0, "Should have agent-responses with error field");
    assert.ok(errorResponses[0].error.includes("Invalid API key"));
  });
});
