const { logger } = require("../utils/logger");

class ResearchService {
  constructor(config = {}) {
    this.provider = config.provider || "none";
    this.apiKey = config.apiKey || "";
    this.maxResults = config.maxResults || 5;
  }

  isAvailable() {
    return this.provider !== "none" && Boolean(this.apiKey);
  }

  async search(query) {
    if (!this.isAvailable()) return [];

    try {
      if (this.provider === "tavily") {
        return await this.tavilySearch(query);
      }
      return [];
    } catch (error) {
      logger.warn("Research search failed — continuing without sources", {
        provider: this.provider,
        message: error.message
      });
      return [];
    }
  }

  async tavilySearch(query) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          search_depth: "advanced",
          max_results: this.maxResults,
          include_raw_content: false
        }),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (!response.ok) {
        logger.warn("Tavily search returned non-OK status", { status: response.status });
        return [];
      }

      const data = await response.json();
      return (data.results || []).map((r) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.content || ""
      }));
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  }

  formatAsContext(results) {
    if (!results || !results.length) return "";

    const lines = results.map((r, i) =>
      `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`
    );

    return [
      "Research Context (web sources):",
      "",
      ...lines,
      "",
      "Cite source numbers [1], [2], etc. when referencing specific findings."
    ].join("\n");
  }
}

module.exports = { ResearchService };
