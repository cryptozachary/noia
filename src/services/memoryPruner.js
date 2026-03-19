const { logger } = require("../utils/logger");
const { analyzeMemory } = require("./memoryAnalyzer");

class MemoryPruner {
  constructor({ store, llmService, snapshotService, embeddingService }) {
    this.store = store;
    this.llmService = llmService;
    this.snapshotService = snapshotService || null;
    this.embeddingService = embeddingService || null;
  }

  async pruneAgentMemory(agentId, options = {}) {
    const maxSections = options.maxSections || 20;
    const keepRecent = options.keepRecent || 5;
    const dryRun = options.dryRun || false;

    const memory = await this.store.readAgentMemory(agentId);
    const sections = splitSections(memory);

    if (sections.length <= maxSections) {
      return { pruned: false, reason: "below threshold", sectionCount: sections.length };
    }

    if (dryRun) {
      const summarizeCount = Math.max(0, sections.length - keepRecent - (sections[0].isHeader ? 0 : 1));
      return {
        pruned: false,
        dryRun: true,
        sectionCount: sections.length,
        wouldSummarize: summarizeCount,
        wouldKeep: keepRecent
      };
    }

    // Snapshot before pruning
    if (this.snapshotService) {
      try {
        await this.snapshotService.createSnapshot(agentId, { label: "pre-prune" });
      } catch (snapErr) {
        logger.warn("Failed to snapshot before prune", { agentId, error: snapErr.message });
      }
    }

    // Separate preamble (text before first ## heading), old sections, recent sections
    let preamble = "";
    let headeredSections = sections;

    if (sections.length > 0 && !sections[0].isHeader) {
      preamble = sections[0].text;
      headeredSections = sections.slice(1);
    }

    const recentSections = headeredSections.slice(-keepRecent);
    const oldSections = headeredSections.slice(0, -keepRecent);

    if (oldSections.length === 0) {
      return { pruned: false, reason: "nothing to summarize", sectionCount: sections.length };
    }

    // Summarize old sections via LLM
    const oldText = oldSections.map((s) => s.text).join("\n\n");
    let summary;
    try {
      const result = await this.llmService.generate({
        systemPrompt: "You condense scientific discussion memory sections into a brief summary. Preserve: key positions, important findings, recurring themes, and growth areas. Drop: redundant details, session-specific timestamps, and verbose reasoning. Output ONLY the condensed summary text.",
        userPrompt: `Condense these ${oldSections.length} memory sections into a concise summary (under 300 words):\n\n${oldText}`,
        override: { maxOutputTokens: 400 }
      });
      summary = (result.text || "").trim();
    } catch (llmErr) {
      logger.warn("LLM summarization failed during prune", { agentId, error: llmErr.message });
      return { pruned: false, reason: "summarization failed", error: llmErr.message };
    }

    if (!summary) {
      return { pruned: false, reason: "empty summary returned" };
    }

    // Reassemble memory
    const parts = [];
    if (preamble.trim()) parts.push(preamble.trim());
    parts.push(`## Summarized History\n${summary}`);
    for (const section of recentSections) {
      parts.push(section.text.trim());
    }
    const newMemory = parts.join("\n\n") + "\n";

    await this.store.writeAgentMemory(agentId, newMemory);

    // Re-index embeddings
    if (this.embeddingService && this.embeddingService.isAvailable()) {
      try {
        const { chunkMemory, truncateEmbedding } = require("./embeddingService");
        const chunks = chunkMemory(newMemory);
        if (chunks.length > 0) {
          const embeddings = await this.embeddingService.embedBatch(chunks);
          await this.store.saveMemoryEmbeddings(agentId, {
            agentId,
            model: this.embeddingService.model,
            updatedAt: new Date().toISOString(),
            chunks: chunks.map((text, i) => ({ text, embedding: truncateEmbedding(embeddings[i]) }))
          });
        }
      } catch (embErr) {
        logger.warn("Failed to re-index embeddings after prune", { agentId, error: embErr.message });
      }
    }

    return {
      pruned: true,
      beforeSections: sections.length,
      afterSections: 1 + recentSections.length + (preamble.trim() ? 1 : 0), // summary + recent + preamble
      summarizedCount: oldSections.length
    };
  }

  async shouldAutoPrune(agentId, threshold = 30) {
    const memory = await this.store.readAgentMemory(agentId);
    const insights = analyzeMemory(memory);
    return insights.sectionCount > threshold;
  }
}

function splitSections(text) {
  if (!text || !text.trim()) return [];

  const parts = text.split(/(?=^## )/m);
  const sections = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    sections.push({
      text: trimmed,
      isHeader: trimmed.startsWith("## ")
    });
  }

  return sections;
}

module.exports = { MemoryPruner };
