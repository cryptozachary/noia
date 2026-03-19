const { AppError } = require("../utils/errors");

const AGENT_REQUIRED_SECTIONS = [
  "Position:",
  "Supporting Reasoning:",
  "Confidence Level:",
  "Claim Classification",
  "Main Uncertainty:",
  "Critique of Others:",
  "Revised View:"
];

const FINAL_REQUIRED_SECTIONS = [
  "1. Topic",
  "2. Executive Summary",
  "3. Known / Established Points",
  "4. Most Promising Hypotheses",
  "5. Major Objections / Risks",
  "6. Proposed Experiments or Validation Steps",
  "7. Unresolved Disagreements",
  "8. Confidence / Uncertainty Summary",
  "9. Suggested Next Research Directions",
  "10. Safety Note / Disclaimer"
];

function validateDiscussionRequest(payload) {
  const topic = (payload.topic || "").trim();
  const title = (payload.title || "").trim();
  const rounds = Number(payload.rounds || 4);

  if (!topic) {
    throw new AppError("Topic is required.", 400);
  }

  if (rounds < 2 || rounds > 8 || !Number.isInteger(rounds)) {
    throw new AppError("Rounds must be an integer between 2 and 8.", 400);
  }

  let stages = null;
  if (Array.isArray(payload.stages) && payload.stages.length > 0) {
    if (payload.stages.length !== rounds) {
      throw new AppError(`Stages array length (${payload.stages.length}) must equal rounds (${rounds}).`, 400);
    }
    stages = payload.stages.map((s, i) => ({
      name: (s.name || "").trim() || (i === rounds - 1 ? "final-synthesis" : `stage-${i + 1}`),
      instruction: (s.instruction || "").trim()
    }));
  }

  return {
    topic,
    title: title || topic.slice(0, 72),
    rounds,
    stages
  };
}

function ensureAgentResponseStructure(text) {
  const source = (text || "").trim();

  if (!source) {
    return AGENT_REQUIRED_SECTIONS.map((section) => `${section}\nNot provided.`).join("\n\n");
  }

  const missing = AGENT_REQUIRED_SECTIONS.filter((section) => {
    return !new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(source);
  });

  if (missing.length === 0) {
    return source;
  }

  const fills = missing.map((section) => `${section}\nNot explicitly provided.`).join("\n\n");
  return `${source}\n\n${fills}`;
}

function ensureFinalReportStructure(text, topic) {
  const source = (text || "").trim();
  const existing = source ? source.split(/\r?\n/).join("\n") : "";

  const missing = FINAL_REQUIRED_SECTIONS.filter((section) => {
    return !new RegExp(`^${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "im").test(existing);
  });

  if (!existing) {
    return buildFallbackFinalReport(topic);
  }

  if (missing.length === 0) {
    return existing;
  }

  const appended = missing.map((section) => `${section}\nNot provided.`).join("\n\n");
  return `${existing}\n\n${appended}`;
}

function buildFallbackFinalReport(topic) {
  return [
    "1. Topic",
    topic,
    "",
    "2. Executive Summary",
    "Insufficient model output. Please rerun discussion.",
    "",
    "3. Known / Established Points",
    "- Not provided.",
    "",
    "4. Most Promising Hypotheses",
    "- Not provided.",
    "",
    "5. Major Objections / Risks",
    "- Not provided.",
    "",
    "6. Proposed Experiments or Validation Steps",
    "- Not provided.",
    "",
    "7. Unresolved Disagreements",
    "- Not provided.",
    "",
    "8. Confidence / Uncertainty Summary",
    "- Confidence unavailable.",
    "",
    "9. Suggested Next Research Directions",
    "- Not provided.",
    "",
    "10. Safety Note / Disclaimer",
    "For research exploration only. Not professional medical advice."
  ].join("\n");
}

module.exports = {
  validateDiscussionRequest,
  ensureAgentResponseStructure,
  ensureFinalReportStructure,
  FINAL_REQUIRED_SECTIONS
};
