const PRICING = {
  // OpenAI — price per 1M tokens
  "gpt-4.1": { input: 2.00, output: 8.00 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60 },
  "gpt-4.1-nano": { input: 0.10, output: 0.40 },
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "o3": { input: 2.00, output: 8.00 },
  "o3-mini": { input: 1.10, output: 4.40 },
  "o4-mini": { input: 1.10, output: 4.40 },
  // Anthropic
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
  "claude-3-5-sonnet-20241022": { input: 3.00, output: 15.00 },
  "claude-3-5-haiku-20241022": { input: 0.80, output: 4.00 },
  "claude-3-opus-20240229": { input: 15.00, output: 75.00 },
  // Embeddings
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 }
};

function getModelPricing(model) {
  if (!model) return null;
  const key = model.toLowerCase();
  if (PRICING[key]) return PRICING[key];

  // Fuzzy prefix match: "gpt-4.1-mini-2025-04-14" → "gpt-4.1-mini"
  const keys = Object.keys(PRICING).sort((a, b) => b.length - a.length);
  for (const prefix of keys) {
    if (key.startsWith(prefix)) return PRICING[prefix];
  }
  return null;
}

function calculateCost(model, usage) {
  const pricing = getModelPricing(model);
  if (!pricing || !usage) return { inputCost: 0, outputCost: 0, totalCost: 0 };

  const inputCost = ((usage.input_tokens || 0) / 1_000_000) * pricing.input;
  const outputCost = ((usage.output_tokens || 0) / 1_000_000) * pricing.output;
  return {
    inputCost: Math.round(inputCost * 1_000_000) / 1_000_000,
    outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
    totalCost: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
  };
}

function estimateRunCost(model, topicLength, rounds, agentCount) {
  const pricing = getModelPricing(model);
  if (!pricing) return { estimatedCost: 0, breakdown: null };

  const charsPerToken = 4;
  const baseTopicTokens = Math.ceil(topicLength / charsPerToken);
  const systemPromptTokens = 500;
  const peerContextGrowth = 300;

  let totalInput = 0;
  let totalOutput = 0;
  const outputPerAgent = 800;

  for (let r = 1; r <= rounds; r++) {
    const contextForRound = baseTopicTokens + systemPromptTokens + peerContextGrowth * (r - 1);
    totalInput += contextForRound * agentCount;
    totalOutput += outputPerAgent * agentCount;
  }

  // Final synthesis round
  totalInput += baseTopicTokens + totalOutput + systemPromptTokens;
  totalOutput += 2000;

  const inputCost = (totalInput / 1_000_000) * pricing.input;
  const outputCost = (totalOutput / 1_000_000) * pricing.output;
  const estimatedCost = Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;

  return {
    estimatedCost,
    breakdown: {
      estimatedInputTokens: totalInput,
      estimatedOutputTokens: totalOutput,
      inputCost: Math.round(inputCost * 1_000_000) / 1_000_000,
      outputCost: Math.round(outputCost * 1_000_000) / 1_000_000
    }
  };
}

function formatCost(cost) {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `~$${cost.toFixed(4)}`;
  return `~$${cost.toFixed(2)}`;
}

module.exports = { PRICING, getModelPricing, calculateCost, estimateRunCost, formatCost };
