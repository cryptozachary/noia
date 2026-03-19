const { logger } = require("../utils/logger");

async function buildArgumentGraph(claims, llmService, override = {}) {
  if (!claims || claims.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Limit claims for LLM processing
  const limitedClaims = claims.slice(0, 50);
  const nodes = limitedClaims.map((c) => ({
    id: c.id,
    text: c.text,
    type: c.type,
    confidence: c.confidence,
    agentId: c.sourceAgentId,
    round: c.sourceRound
  }));

  let edges = [];
  try {
    const claimList = limitedClaims.map((c, i) => `${i + 1}. [${c.id}] (${c.sourceAgentId}, R${c.sourceRound}): ${c.text}`).join("\n");

    const result = await llmService.generate({
      systemPrompt: "You identify relationships between scientific claims. Return ONLY a JSON array. Each element: {\"source\": \"claim-id\", \"target\": \"claim-id\", \"type\": \"supports|contradicts|extends\"}. Only include clear, meaningful relationships. If uncertain, omit.",
      userPrompt: `Identify relationships between these claims:\n\n${claimList}`,
      override: { ...override, maxOutputTokens: 800 }
    });

    const parsed = parseEdges(result.text, limitedClaims);
    edges = parsed;
  } catch (err) {
    logger.warn("Graph edge detection failed", { error: err.message });
  }

  return { nodes, edges };
}

function parseEdges(text, claims) {
  if (!text) return [];
  let cleaned = text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    const validIds = new Set(claims.map((c) => c.id));
    return arr
      .filter((e) => validIds.has(e.source) && validIds.has(e.target) && e.source !== e.target)
      .filter((e) => ["supports", "contradicts", "extends"].includes(e.type))
      .map((e) => ({ source: e.source, target: e.target, type: e.type }));
  } catch {
    return [];
  }
}

function computeMetrics(graph, run) {
  const { nodes, edges } = graph;
  if (!nodes || nodes.length === 0) {
    return {
      consensusScore: 0,
      evidenceDensity: 0,
      claimDiversity: 0,
      convergenceRate: 0,
      totalClaims: 0,
      totalEdges: 0,
      claimsByAgent: {},
      claimsByRound: {}
    };
  }

  const supporting = edges.filter((e) => e.type === "supports").length;
  const contradicting = edges.filter((e) => e.type === "contradicts").length;
  const consensusScore = supporting + contradicting > 0 ? supporting / (supporting + contradicting) : 0.5;

  const evidenceClaims = nodes.filter((n) => n.type === "evidence").length;
  const evidenceDensity = nodes.length > 0 ? evidenceClaims / nodes.length : 0;

  // Claim diversity: how many different types each agent uses, normalized
  const agentTypes = {};
  for (const node of nodes) {
    if (!agentTypes[node.agentId]) agentTypes[node.agentId] = new Set();
    agentTypes[node.agentId].add(node.type);
  }
  const maxTypes = 4;
  const avgTypesPerAgent = Object.values(agentTypes).reduce((sum, s) => sum + s.size, 0) / Math.max(Object.keys(agentTypes).length, 1);
  const claimDiversity = avgTypesPerAgent / maxTypes;

  // Convergence rate: contradiction ratio in early vs late rounds
  const rounds = [...new Set(nodes.map((n) => n.round))].sort((a, b) => a - b);
  let convergenceRate = 0.5;
  if (rounds.length >= 2) {
    const midpoint = rounds[Math.floor(rounds.length / 2)];
    const earlyNodeIds = new Set(nodes.filter((n) => n.round <= midpoint).map((n) => n.id));
    const lateNodeIds = new Set(nodes.filter((n) => n.round > midpoint).map((n) => n.id));
    const earlyContradictions = edges.filter((e) => e.type === "contradicts" && (earlyNodeIds.has(e.source) || earlyNodeIds.has(e.target))).length;
    const lateContradictions = edges.filter((e) => e.type === "contradicts" && (lateNodeIds.has(e.source) || lateNodeIds.has(e.target))).length;
    if (earlyContradictions > 0) {
      convergenceRate = 1 - (lateContradictions / earlyContradictions);
    } else {
      convergenceRate = lateContradictions === 0 ? 1 : 0;
    }
    convergenceRate = Math.max(0, Math.min(1, convergenceRate));
  }

  const claimsByAgent = {};
  const claimsByRound = {};
  for (const node of nodes) {
    claimsByAgent[node.agentId] = (claimsByAgent[node.agentId] || 0) + 1;
    claimsByRound[node.round] = (claimsByRound[node.round] || 0) + 1;
  }

  return {
    consensusScore: Math.round(consensusScore * 100) / 100,
    evidenceDensity: Math.round(evidenceDensity * 100) / 100,
    claimDiversity: Math.round(claimDiversity * 100) / 100,
    convergenceRate: Math.round(convergenceRate * 100) / 100,
    totalClaims: nodes.length,
    totalEdges: edges.length,
    claimsByAgent,
    claimsByRound
  };
}

module.exports = { buildArgumentGraph, computeMetrics };
