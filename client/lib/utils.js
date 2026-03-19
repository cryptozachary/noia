export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function agentCssClass(agentId) {
  const map = {
    "research-synthesizer": "synth",
    "skeptical-reviewer": "skeptic",
    "innovation-strategist": "innov"
  };
  return map[agentId] || "custom";
}
