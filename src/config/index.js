const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const rootDir = path.resolve(__dirname, "..", "..");
const dataDir = path.join(rootDir, "data");

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const config = {
  rootDir,
  dataDir,
  port: parseNumber(process.env.PORT, 3000),
  llmProvider: process.env.LLM_PROVIDER || "openai",
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    maxOutputTokens: parseNumber(process.env.OPENAI_MAX_OUTPUT_TOKENS, 1200),
    temperature: parseNumber(process.env.OPENAI_TEMPERATURE, 0.2),
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT || "medium",
    retries: parseNumber(process.env.OPENAI_RETRIES, 2),
    timeoutMs: parseNumber(process.env.OPENAI_TIMEOUT_MS, 60000)
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
    maxOutputTokens: parseNumber(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS, 4096),
    retries: parseNumber(process.env.ANTHROPIC_RETRIES, 2),
    timeoutMs: parseNumber(process.env.ANTHROPIC_TIMEOUT_MS, 90000)
  },
  search: {
    provider: process.env.SEARCH_PROVIDER || "tavily",
    apiKey: process.env.TAVILY_API_KEY || "",
    maxResults: parseNumber(process.env.SEARCH_MAX_RESULTS, 5)
  },
  embedding: {
    model: process.env.EMBEDDING_MODEL || "text-embedding-3-small"
  },
  requireAuth: process.env.REQUIRE_AUTH === "true",
  adminApiKey: process.env.ADMIN_API_KEY || "",
  agentRetries: parseNumber(process.env.AGENT_RETRIES, 1),
  agentRetryDelayMs: parseNumber(process.env.AGENT_RETRY_DELAY_MS, 2000),
  memoryPrune: {
    maxSections: parseNumber(process.env.MEMORY_MAX_SECTIONS, 20),
    keepRecent: parseNumber(process.env.MEMORY_KEEP_RECENT, 5),
    autoThreshold: parseNumber(process.env.MEMORY_AUTO_PRUNE_THRESHOLD, 30)
  },
  storageBackend: process.env.STORAGE_BACKEND || "file",
  sqlitePath: process.env.SQLITE_PATH || ""
};

module.exports = { config };
