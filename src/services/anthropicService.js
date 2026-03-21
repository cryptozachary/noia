const Anthropic = require("@anthropic-ai/sdk");
const { logger } = require("../utils/logger");
const { AppError } = require("../utils/errors");

class AnthropicService {
  constructor(config) {
    this.config = config;
    this.client = config.apiKey ? new Anthropic({ apiKey: config.apiKey }) : null;
  }

  assertReady() {
    if (!this.client) {
      throw new AppError("ANTHROPIC_API_KEY is missing. Add it to .env before running discussions.", 500);
    }
  }

  async generate({ systemPrompt, userPrompt, override = {}, tools }) {
    this.assertReady();

    const model = override.model || this.config.model;
    const maxTokens = override.maxOutputTokens || this.config.maxOutputTokens;

    let attempt = 0;
    const maxAttempts = Math.max(1, this.config.retries + 1);

    while (attempt < maxAttempts) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await this.client.messages.create(
          {
            model,
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
            ...(tools && tools.length > 0 ? { tools } : {})
          },
          { signal: controller.signal }
        );

        clearTimeout(timer);

        const text = (response.content || [])
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim();

        const usage = response.usage
          ? {
              input_tokens: response.usage.input_tokens || 0,
              output_tokens: response.usage.output_tokens || 0,
              total_tokens: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0)
            }
          : null;

        if (!text) {
          throw new Error("Anthropic response did not include output text.");
        }

        const sources = extractWebSources(response);
        return { text, usage, sources };
      } catch (error) {
        clearTimeout(timer);
        logger.warn("Anthropic call attempt failed", { attempt, message: error.message });

        if (attempt >= maxAttempts) {
          throw new AppError("Anthropic generation failed after retries.", 502, {
            message: error.message
          });
        }

        await sleep(350 * attempt);
      }
    }

    throw new AppError("Anthropic generation failed unexpectedly.", 502);
  }

  async generateStream({ systemPrompt, userPrompt, override = {}, onToken, onToolEvent, tools }) {
    this.assertReady();

    const model = override.model || this.config.model;
    const maxTokens = override.maxOutputTokens || this.config.maxOutputTokens;

    let attempt = 0;
    const maxAttempts = Math.max(1, this.config.retries + 1);

    while (attempt < maxAttempts) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const stream = this.client.messages.stream(
          {
            model,
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
            ...(tools && tools.length > 0 ? { tools } : {})
          },
          { signal: controller.signal }
        );

        stream.on("text", (text) => {
          if (onToken) onToken(text);
        });

        stream.on("contentBlock", (block) => {
          if (block.type === "web_search_tool_result" || block.type === "server_tool_use") {
            if (onToolEvent) onToolEvent({ type: "web_search", status: "completed" });
          }
        });

        const message = await stream.finalMessage();
        clearTimeout(timer);

        const text = (message.content || [])
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n")
          .trim();

        const usage = message.usage
          ? {
              input_tokens: message.usage.input_tokens || 0,
              output_tokens: message.usage.output_tokens || 0,
              total_tokens: (message.usage.input_tokens || 0) + (message.usage.output_tokens || 0)
            }
          : null;

        if (!text) {
          throw new Error("Anthropic stream did not produce output text.");
        }

        const sources = extractWebSources(message);
        return { text, usage, sources };
      } catch (error) {
        clearTimeout(timer);
        logger.warn("Anthropic stream attempt failed", { attempt, message: error.message });

        if (attempt >= maxAttempts) {
          throw new AppError("Anthropic streaming failed after retries.", 502, {
            message: error.message
          });
        }

        await sleep(350 * attempt);
      }
    }

    throw new AppError("Anthropic streaming failed unexpectedly.", 502);
  }
}

function extractWebSources(message) {
  const sources = [];
  const content = Array.isArray(message.content) ? message.content : [];
  for (const block of content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (result.type === "web_search_result" && result.url) {
          sources.push({ title: result.title || "", url: result.url });
        }
      }
    }
  }
  const seen = new Set();
  return sources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { AnthropicService };
