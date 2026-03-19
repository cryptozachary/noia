const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { ResearchService } = require("../src/services/researchService");

describe("ResearchService", () => {
  it("isAvailable returns false with no API key", () => {
    const svc = new ResearchService({ provider: "tavily", apiKey: "" });
    assert.equal(svc.isAvailable(), false);
  });

  it("isAvailable returns false for provider none", () => {
    const svc = new ResearchService({ provider: "none", apiKey: "key" });
    assert.equal(svc.isAvailable(), false);
  });

  it("isAvailable returns true with provider and key", () => {
    const svc = new ResearchService({ provider: "tavily", apiKey: "test-key" });
    assert.equal(svc.isAvailable(), true);
  });

  it("search returns empty array when not available", async () => {
    const svc = new ResearchService({ provider: "none" });
    const results = await svc.search("test query");
    assert.deepEqual(results, []);
  });

  it("formatAsContext returns empty string for no results", () => {
    const svc = new ResearchService({});
    assert.equal(svc.formatAsContext([]), "");
    assert.equal(svc.formatAsContext(null), "");
  });

  it("formatAsContext formats results with numbers and citation instruction", () => {
    const svc = new ResearchService({});
    const results = [
      { title: "Paper A", url: "https://a.com", snippet: "Finding A" },
      { title: "Paper B", url: "https://b.com", snippet: "Finding B" }
    ];
    const context = svc.formatAsContext(results);
    assert.ok(context.includes("[1] Paper A"));
    assert.ok(context.includes("[2] Paper B"));
    assert.ok(context.includes("https://a.com"));
    assert.ok(context.includes("Cite source numbers"));
  });
});
