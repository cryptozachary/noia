const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { analyzeMemory, extractTopics } = require("../src/services/memoryAnalyzer");

describe("analyzeMemory", () => {
  it("returns correct totalSize for known string", () => {
    const text = "Hello, world!";
    const result = analyzeMemory(text);
    assert.strictEqual(result.totalSize, Buffer.byteLength(text, "utf8"));
  });

  it("counts ## sections correctly", () => {
    const text = "# Memory\n\n## Section One\nContent here.\n\n## Section Two\nMore content.\n\n## Section Three\nFinal.";
    const result = analyzeMemory(text);
    assert.strictEqual(result.sectionCount, 3);
  });

  it("extracts topic keywords from headings", () => {
    const text = "# Memory\n\n## Battery Chemistry\nLithium ion details.\n\n## Solid State Electrolytes\nGlass ceramics.";
    const result = analyzeMemory(text);
    assert.ok(result.topicKeywords.some((k) => k.includes("Battery")));
    assert.ok(result.topicKeywords.some((k) => k.includes("Solid")));
  });

  it("returns empty keywords for empty text", () => {
    const result = analyzeMemory("");
    assert.deepStrictEqual(result.topicKeywords, []);
    assert.strictEqual(result.sectionCount, 0);
    assert.strictEqual(result.totalSize, 0);
  });

  it("detects lastUpdated date from session headings", () => {
    const text = "# Memory\n\n## Session: run-2026-03-18T10:30:00Z\nLearned about X.\n\n## Session: run-2026-03-19T14:00:00Z\nLearned about Y.";
    const result = analyzeMemory(text);
    assert.ok(result.lastUpdated);
    assert.ok(result.lastUpdated.includes("2026-03-19"));
  });

  it("handles null/undefined gracefully", () => {
    const result = analyzeMemory(null);
    assert.strictEqual(result.totalSize, 0);
    assert.strictEqual(result.sectionCount, 0);
    assert.deepStrictEqual(result.topicKeywords, []);
    assert.strictEqual(result.lastUpdated, null);
  });
});

describe("extractTopics", () => {
  it("skips Session headings", () => {
    const text = "## Session: run-123\nContent.\n\n## Interesting Topic\nDetails.";
    const topics = extractTopics(text);
    assert.ok(!topics.some((t) => t.includes("Session")));
    assert.ok(topics.some((t) => t.includes("Interesting")));
  });

  it("returns frequent words from content", () => {
    const text = "battery battery battery lithium lithium lithium electrode electrode electrode anode anode anode";
    const topics = extractTopics(text);
    assert.ok(topics.length > 0);
    assert.ok(topics.some((t) => t === "battery" || t === "lithium"));
  });

  it("returns empty for empty input", () => {
    assert.deepStrictEqual(extractTopics(""), []);
    assert.deepStrictEqual(extractTopics(null), []);
  });
});
