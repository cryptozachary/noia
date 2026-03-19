const { randomUUID } = require("crypto");
const { logger } = require("../utils/logger");

async function extractClaims(run, llmService, override = {}) {
  const claims = [];

  for (const round of run.roundMessages || []) {
    if (round.stage === "final-synthesis") continue;

    for (const msg of round.messages || []) {
      if (!msg.content || msg.error) continue;

      try {
        const result = await llmService.generate({
          systemPrompt: "You extract claims from scientific discussion responses. Return ONLY a JSON array. Each element: {\"text\": \"claim statement (1-2 sentences)\", \"type\": \"position|evidence|objection|proposal\", \"confidence\": \"high|medium|low\"}. If no clear claims, return [].",
          userPrompt: `Extract key claims from this agent response:\n\n${msg.content.slice(0, 3000)}`,
          override: { ...override, maxOutputTokens: 500 }
        });

        const parsed = parseJsonArray(result.text);
        for (const item of parsed) {
          claims.push({
            id: `claim-${randomUUID().slice(0, 8)}`,
            text: String(item.text || "").slice(0, 200),
            type: ["position", "evidence", "objection", "proposal"].includes(item.type) ? item.type : "position",
            confidence: ["high", "medium", "low"].includes(item.confidence) ? item.confidence : "medium",
            sourceAgentId: msg.agentId,
            sourceRound: round.round,
            sourceStage: round.stage
          });
        }
      } catch (err) {
        logger.warn("Claim extraction failed for message", { agentId: msg.agentId, round: round.round, error: err.message });
      }
    }
  }

  return claims;
}

function parseJsonArray(text) {
  if (!text) return [];
  // Strip markdown code fences
  let cleaned = text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
  // Find the array
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

module.exports = { extractClaims, parseJsonArray };
