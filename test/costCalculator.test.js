const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { getModelPricing, calculateCost, estimateRunCost, formatCost } = require("../src/services/costCalculator");

describe("getModelPricing", () => {
  it("returns pricing for exact model match", () => {
    const pricing = getModelPricing("gpt-4.1-mini");
    assert.deepStrictEqual(pricing, { input: 0.40, output: 1.60 });
  });

  it("returns pricing for fuzzy prefix match", () => {
    const pricing = getModelPricing("gpt-4.1-mini-2025-04-14");
    assert.deepStrictEqual(pricing, { input: 0.40, output: 1.60 });
  });

  it("is case-insensitive", () => {
    const pricing = getModelPricing("GPT-4.1-MINI");
    assert.deepStrictEqual(pricing, { input: 0.40, output: 1.60 });
  });

  it("returns null for unknown model", () => {
    assert.strictEqual(getModelPricing("unknown-model-xyz"), null);
  });

  it("returns null for empty input", () => {
    assert.strictEqual(getModelPricing(""), null);
    assert.strictEqual(getModelPricing(null), null);
  });

  it("matches Anthropic models", () => {
    const pricing = getModelPricing("claude-sonnet-4-20250514");
    assert.strictEqual(pricing.input, 3.00);
    assert.strictEqual(pricing.output, 15.00);
  });
});

describe("calculateCost", () => {
  it("calculates cost for known model", () => {
    const result = calculateCost("gpt-4.1-mini", { input_tokens: 1000, output_tokens: 500 });
    assert.strictEqual(result.inputCost, 0.0004);
    assert.strictEqual(result.outputCost, 0.0008);
    assert.strictEqual(result.totalCost, 0.0012);
  });

  it("returns zero for unknown model", () => {
    const result = calculateCost("nonexistent", { input_tokens: 1000, output_tokens: 500 });
    assert.strictEqual(result.totalCost, 0);
  });

  it("returns zero for null usage", () => {
    const result = calculateCost("gpt-4.1-mini", null);
    assert.strictEqual(result.totalCost, 0);
  });

  it("handles zero tokens", () => {
    const result = calculateCost("gpt-4.1-mini", { input_tokens: 0, output_tokens: 0 });
    assert.strictEqual(result.totalCost, 0);
  });

  it("handles large token counts", () => {
    const result = calculateCost("claude-3-opus-20240229", { input_tokens: 1_000_000, output_tokens: 500_000 });
    assert.strictEqual(result.inputCost, 15);
    assert.strictEqual(result.outputCost, 37.5);
    assert.strictEqual(result.totalCost, 52.5);
  });
});

describe("estimateRunCost", () => {
  it("returns positive estimate for valid inputs", () => {
    const result = estimateRunCost("gpt-4.1-mini", 500, 3, 3);
    assert.ok(result.estimatedCost > 0);
    assert.ok(result.breakdown);
    assert.ok(result.breakdown.estimatedInputTokens > 0);
    assert.ok(result.breakdown.estimatedOutputTokens > 0);
  });

  it("returns zero for unknown model", () => {
    const result = estimateRunCost("nonexistent", 500, 3, 3);
    assert.strictEqual(result.estimatedCost, 0);
    assert.strictEqual(result.breakdown, null);
  });

  it("scales with rounds", () => {
    const r2 = estimateRunCost("gpt-4.1-mini", 500, 2, 3);
    const r4 = estimateRunCost("gpt-4.1-mini", 500, 4, 3);
    assert.ok(r4.estimatedCost > r2.estimatedCost);
  });

  it("scales with agent count", () => {
    const a2 = estimateRunCost("gpt-4.1-mini", 500, 3, 2);
    const a4 = estimateRunCost("gpt-4.1-mini", 500, 3, 4);
    assert.ok(a4.estimatedCost > a2.estimatedCost);
  });
});

describe("formatCost", () => {
  it("formats zero", () => {
    assert.strictEqual(formatCost(0), "$0.00");
  });

  it("formats small costs with 4 decimals", () => {
    assert.strictEqual(formatCost(0.0012), "~$0.0012");
  });

  it("formats larger costs with 2 decimals", () => {
    assert.strictEqual(formatCost(1.50), "~$1.50");
  });
});
