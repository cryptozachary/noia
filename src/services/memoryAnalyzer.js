const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
  "by", "from", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might", "shall",
  "not", "no", "nor", "so", "if", "then", "than", "that", "this", "these", "those",
  "it", "its", "as", "up", "out", "about", "into", "over", "after", "before", "between",
  "under", "again", "further", "once", "here", "there", "when", "where", "why", "how",
  "all", "each", "every", "both", "few", "more", "most", "other", "some", "such",
  "only", "own", "same", "very", "can", "just", "also", "new", "one", "two"
]);

function analyzeMemory(memoryText) {
  if (!memoryText) {
    return { totalSize: 0, sectionCount: 0, topicKeywords: [], lastUpdated: null };
  }

  const text = String(memoryText);
  const totalSize = Buffer.byteLength(text, "utf8");

  const lines = text.split("\n");
  const sectionHeadings = lines.filter((line) => line.startsWith("## "));
  const sectionCount = sectionHeadings.length;

  const topicKeywords = extractTopics(text);

  let lastUpdated = null;
  const datePattern = /(\d{4}-\d{2}-\d{2}T[\d:.\-Z]+)/g;
  let match;
  while ((match = datePattern.exec(text)) !== null) {
    const d = match[1];
    if (!lastUpdated || d > lastUpdated) lastUpdated = d;
  }

  return { totalSize, sectionCount, topicKeywords, lastUpdated };
}

function extractTopics(memoryText) {
  if (!memoryText) return [];

  const text = String(memoryText);
  const lines = text.split("\n");
  const keywords = [];

  // Extract heading text (skip session headings and top-level #)
  for (const line of lines) {
    if (line.startsWith("## ") && !line.startsWith("## Session:") && !line.startsWith("## Memory")) {
      const heading = line.slice(3).trim();
      if (heading.length > 2) keywords.push(heading);
    }
  }

  // Word frequency analysis
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  const freq = {};
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }

  const frequent = Object.entries(freq)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, 10);

  // Combine headings + frequent words, deduplicate
  const seen = new Set();
  const result = [];
  for (const kw of [...keywords, ...frequent]) {
    const lower = kw.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(kw);
    }
    if (result.length >= 10) break;
  }

  return result;
}

module.exports = { analyzeMemory, extractTopics };
