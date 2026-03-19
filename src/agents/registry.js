const DEFAULT_AGENTS = [
  {
    id: "research-synthesizer",
    name: "Research Synthesizer",
    shortName: "Synthesizer",
    purpose: "Map established background, terminology, and current approaches.",
    color: "var(--agent-synth)"
  },
  {
    id: "skeptical-reviewer",
    name: "Skeptical Reviewer",
    shortName: "Reviewer",
    purpose: "Stress-test claims, expose weak evidence, and identify risk.",
    color: "var(--agent-skeptic)"
  },
  {
    id: "innovation-strategist",
    name: "Innovation Strategist",
    shortName: "Strategist",
    purpose: "Propose inventive, testable hypotheses and experiments.",
    color: "var(--agent-innov)"
  },
  {
    id: "coordinator",
    name: "Coordinator",
    shortName: "Coordinator",
    purpose: "Enforce round structure and produce final synthesis.",
    color: "var(--agent-coord)"
  }
];

let runtimeAgents = [...DEFAULT_AGENTS];

function getAgent(agentId) {
  return runtimeAgents.find((agent) => agent.id === agentId) || null;
}

function getScientistAgentIds() {
  return runtimeAgents.filter((a) => a.id !== "coordinator").map((a) => a.id);
}

function addAgent(agentDef) {
  const existing = runtimeAgents.findIndex((a) => a.id === agentDef.id);
  if (existing >= 0) {
    runtimeAgents[existing] = agentDef;
  } else {
    runtimeAgents.push(agentDef);
  }
}

function removeAgent(agentId) {
  runtimeAgents = runtimeAgents.filter((a) => a.id !== agentId);
}

function reloadFromDisk(agentIds) {
  const knownIds = new Set(runtimeAgents.map((a) => a.id));
  for (const id of agentIds) {
    if (!knownIds.has(id)) {
      const name = id
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      runtimeAgents.push({
        id,
        name,
        shortName: name,
        purpose: "Custom agent",
        color: "var(--agent-custom)"
      });
    }
  }
}

// Backward-compatible exports
const AGENTS = runtimeAgents;
const SCIENTIST_AGENT_IDS = null; // Deprecated: use getScientistAgentIds()

module.exports = {
  AGENTS,
  SCIENTIST_AGENT_IDS,
  DEFAULT_AGENTS,
  getAgent,
  getScientistAgentIds,
  addAgent,
  removeAgent,
  reloadFromDisk
};
