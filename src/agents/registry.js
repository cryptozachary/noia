const AGENTS = [
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

const SCIENTIST_AGENT_IDS = AGENTS.filter((agent) => agent.id !== "coordinator").map((agent) => agent.id);

function getAgent(agentId) {
  return AGENTS.find((agent) => agent.id === agentId) || null;
}

module.exports = { AGENTS, SCIENTIST_AGENT_IDS, getAgent };
