const { getAgent } = require("./registry");

function formatPeerMessages(peerMessages) {
  if (!peerMessages || peerMessages.length === 0) {
    return "No peer messages yet.";
  }

  return peerMessages
    .map((msg) => {
      return `- [${msg.agentName}] Round ${msg.round}:\n${msg.content}`;
    })
    .join("\n\n");
}

function buildStageInstruction(stage) {
  if (stage === "initial-positions") {
    return [
      "Focus on initial analysis for the topic.",
      "Provide concrete directions or concerns; avoid repeating generic background."
    ].join(" ");
  }

  if (stage === "cross-critique") {
    return [
      "You must critique peer ideas directly.",
      "Include: strongest point from another agent, biggest flaw, and one revised idea."
    ].join(" ");
  }

  if (stage === "convergence") {
    return [
      "Narrow to top 3 promising directions, top bottlenecks, and top experiments.",
      "Be selective and justify tradeoffs."
    ].join(" ");
  }

  return "Respond with scientifically grounded analysis.";
}

function composeScientistPrompt({ agentId, topic, roundNumber, stage, peerMessages }) {
  const agent = getAgent(agentId);

  return [
    `Topic: ${topic}`,
    `Round: ${roundNumber}`,
    `Stage: ${stage}`,
    `Your role: ${agent ? agent.name : agentId}`,
    buildStageInstruction(stage),
    "Use the required structure exactly:",
    "Position:",
    "Supporting Reasoning:",
    "Confidence Level:",
    "Claim Classification (Established | Inferred | Speculative):",
    "Main Uncertainty:",
    "Critique of Others:",
    "Revised View:",
    "Keep content concise and specific.",
    "Peer context:",
    formatPeerMessages(peerMessages)
  ].join("\n\n");
}

function composeCoordinatorFinalPrompt({ topic, discussionText, isMedicalTopic }) {
  const medicalInstruction = isMedicalTopic
    ? "Topic appears medical/health-related. Section 10 must explicitly say this is not medical advice."
    : "Section 10 should still include a research-only disclaimer.";

  return [
    `Topic: ${topic}`,
    medicalInstruction,
    "Create a final synthesis with exactly these numbered sections and headings:",
    "1. Topic",
    "2. Executive Summary",
    "3. Known / Established Points",
    "4. Most Promising Hypotheses",
    "5. Major Objections / Risks",
    "6. Proposed Experiments or Validation Steps",
    "7. Unresolved Disagreements",
    "8. Confidence / Uncertainty Summary",
    "9. Suggested Next Research Directions",
    "10. Safety Note / Disclaimer",
    "Be concrete, avoid overclaiming, and clearly distinguish established vs inferred vs speculative statements.",
    "Discussion transcript:",
    discussionText
  ].join("\n\n");
}

module.exports = {
  composeScientistPrompt,
  composeCoordinatorFinalPrompt
};
