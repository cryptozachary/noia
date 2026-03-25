export const PRICING = {
  "gpt-4.1": { input: 2.00, output: 8.00 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60 },
  "gpt-4.1-nano": { input: 0.10, output: 0.40 },
  "gpt-5.4": { input: 2.50, output: 15.00 },
  "gpt-5.4-mini": { input: 0.75, output: 4.50 },
  "gpt-5.4-nano": { input: 0.20, output: 1.25 },
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "o3": { input: 2.00, output: 8.00 },
  "o3-mini": { input: 1.10, output: 4.40 },
  "o4-mini": { input: 1.10, output: 4.40 },
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
  "claude-3-5-sonnet-20241022": { input: 3.00, output: 15.00 },
  "claude-3-5-haiku-20241022": { input: 0.80, output: 4.00 },
  "claude-3-opus-20240229": { input: 15.00, output: 75.00 }
};

export function clientCalculateCost(model, usage) {
  if (!model || !usage) return 0;
  const key = model.toLowerCase();
  let pricing = PRICING[key];
  if (!pricing) {
    const keys = Object.keys(PRICING).sort((a, b) => b.length - a.length);
    for (const prefix of keys) {
      if (key.startsWith(prefix)) { pricing = PRICING[prefix]; break; }
    }
  }
  if (!pricing) return 0;
  return ((usage.input_tokens || 0) / 1e6) * pricing.input + ((usage.output_tokens || 0) / 1e6) * pricing.output;
}

export function formatCost(cost) {
  if (!cost || cost === 0) return "";
  if (cost < 0.01) return `~$${cost.toFixed(4)}`;
  return `~$${cost.toFixed(2)}`;
}
