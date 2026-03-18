const MEDICAL_KEYWORDS = [
  "cancer",
  "therapy",
  "treatment",
  "disease",
  "clinical",
  "patient",
  "drug",
  "medicine",
  "medical",
  "diagnosis",
  "anti-aging",
  "longevity"
];

function isMedicalTopic(topic) {
  const input = (topic || "").toLowerCase();
  return MEDICAL_KEYWORDS.some((keyword) => input.includes(keyword));
}

function safetySystemAddendum() {
  return [
    "Safety and scientific integrity requirements:",
    "- Distinguish established knowledge, plausible inference, and speculation.",
    "- Include explicit confidence level.",
    "- Avoid presenting speculative medical claims as fact.",
    "- Prefer phrasing such as 'promising direction', 'hypothesis', or 'proposed experiment' instead of definitive claims."
  ].join("\n");
}

function ensureMedicalDisclaimer(text) {
  const disclaimer =
    "This output is for exploratory scientific discussion only and is not medical advice, diagnosis, or treatment guidance.";

  const source = (text || "").trim();
  if (!source) {
    return source;
  }

  if (source.toLowerCase().includes("not medical advice")) {
    return source;
  }

  const sectionPattern = /(10\.\s*Safety Note \/ Disclaimer\s*[\r\n]+)([\s\S]*)$/i;
  if (sectionPattern.test(source)) {
    return source.replace(sectionPattern, (_match, heading, body) => {
      const trimmed = body.trim();
      const next = trimmed ? `${trimmed}\n${disclaimer}` : disclaimer;
      return `${heading}${next}`;
    });
  }

  return `${source}\n\n10. Safety Note / Disclaimer\n${disclaimer}`;
}

module.exports = {
  isMedicalTopic,
  safetySystemAddendum,
  ensureMedicalDisclaimer
};
