const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { cosineSimilarity, chunkMemory, truncateEmbedding } = require("../src/services/embeddingService");

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 2, 3];
    const sim = cosineSimilarity(v, v);
    assert.ok(Math.abs(sim - 1) < 0.0001);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    assert.ok(Math.abs(cosineSimilarity(a, b)) < 0.0001);
  });

  it("returns -1 for opposite vectors", () => {
    const a = [1, 0];
    const b = [-1, 0];
    assert.ok(Math.abs(cosineSimilarity(a, b) + 1) < 0.0001);
  });

  it("returns 0 for empty vectors", () => {
    assert.strictEqual(cosineSimilarity([], []), 0);
  });

  it("returns 0 for null inputs", () => {
    assert.strictEqual(cosineSimilarity(null, [1, 2]), 0);
    assert.strictEqual(cosineSimilarity([1, 2], null), 0);
  });

  it("returns 0 for mismatched lengths", () => {
    assert.strictEqual(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  });
});

describe("chunkMemory", () => {
  it("returns empty for empty text", () => {
    assert.deepStrictEqual(chunkMemory(""), []);
    assert.deepStrictEqual(chunkMemory(null), []);
  });

  it("splits on ## headers", () => {
    const memory = "# Memory\nBase info here that is long enough.\n\n## Session: run-1\nLearning about science.\n\n## Session: run-2\nLearning about biology.";
    const chunks = chunkMemory(memory);
    assert.ok(chunks.length >= 2);
  });

  it("returns single chunk for text without headers", () => {
    const memory = "This is a plain memory text that has no section headers but is quite long.";
    const chunks = chunkMemory(memory);
    assert.strictEqual(chunks.length, 1);
  });

  it("filters out very short chunks", () => {
    const memory = "# Memory\n\n## A\nShort.\n\n## B\nThis is a reasonably long chunk of memory text.";
    const chunks = chunkMemory(memory);
    for (const chunk of chunks) {
      assert.ok(chunk.length > 20);
    }
  });
});

describe("truncateEmbedding", () => {
  it("truncates to 4 decimal places by default", () => {
    const emb = [0.123456789, -0.987654321];
    const result = truncateEmbedding(emb);
    assert.strictEqual(result[0], 0.1235);
    assert.strictEqual(result[1], -0.9877);
  });

  it("supports custom decimal places", () => {
    const emb = [0.123456];
    const result = truncateEmbedding(emb, 2);
    assert.strictEqual(result[0], 0.12);
  });
});
