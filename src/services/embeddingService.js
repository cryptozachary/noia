const OpenAI = require("openai");
const { logger } = require("../utils/logger");

class EmbeddingService {
  constructor(openaiConfig) {
    this.config = openaiConfig;
    this.model = openaiConfig.embeddingModel || "text-embedding-3-small";
    this.client = openaiConfig.apiKey ? new OpenAI({ apiKey: openaiConfig.apiKey }) : null;
  }

  isAvailable() {
    return Boolean(this.client);
  }

  async embed(text) {
    if (!this.client) return null;
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text.slice(0, 8000)
    });
    return response.data[0].embedding;
  }

  async embedBatch(texts) {
    if (!this.client || !texts.length) return [];
    const truncated = texts.map((t) => t.slice(0, 8000));
    const response = await this.client.embeddings.create({
      model: this.model,
      input: truncated
    });
    return response.data.map((d) => d.embedding);
  }

  searchSimilar(queryEmbedding, storedChunks, topK = 5) {
    if (!queryEmbedding || !storedChunks || !storedChunks.length) return [];
    const scored = storedChunks.map((chunk) => ({
      text: chunk.text,
      score: cosineSimilarity(queryEmbedding, chunk.embedding)
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function chunkMemory(memoryText) {
  if (!memoryText || !memoryText.trim()) return [];
  const sections = memoryText.split(/(?=^## )/m);
  const chunks = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed.length > 20) {
      chunks.push(trimmed);
    }
  }
  if (chunks.length === 0 && memoryText.trim().length > 20) {
    chunks.push(memoryText.trim());
  }
  return chunks;
}

function truncateEmbedding(embedding, decimals = 4) {
  const factor = Math.pow(10, decimals);
  return embedding.map((v) => Math.round(v * factor) / factor);
}

module.exports = { EmbeddingService, cosineSimilarity, chunkMemory, truncateEmbedding };
