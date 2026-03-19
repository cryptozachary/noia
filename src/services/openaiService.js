const OpenAI = require("openai");
const { logger } = require("../utils/logger");
const { AppError } = require("../utils/errors");

class OpenAIService {
  constructor(config) {
    this.config = config;
    this.client = config.apiKey ? new OpenAI({ apiKey: config.apiKey }) : null;
  }

  assertReady() {
    if (!this.client) {
      throw new AppError("OPENAI_API_KEY is missing. Add it to .env before running discussions.", 500);
    }
  }

  async generate({ systemPrompt, userPrompt, override = {}, tools }) {
    this.assertReady();

    const model = override.model || this.config.model;
    const maxOutputTokens = override.maxOutputTokens || this.config.maxOutputTokens;
    const temperature = Number.isFinite(override.temperature) ? override.temperature : this.config.temperature;
    const reasoningEffort = override.reasoningEffort || this.config.reasoningEffort;

    let attempt = 0;
    const maxAttempts = Math.max(1, this.config.retries + 1);

    while (attempt < maxAttempts) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await this.client.responses.create(
          {
            model,
            instructions: systemPrompt,
            input: userPrompt,
            max_output_tokens: maxOutputTokens,
            reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
            ...(tools && tools.length > 0 ? { tools } : {})
          },
          { signal: controller.signal }
        );

        clearTimeout(timer);

        const usage = response.usage || null;

        if (response.output_text && response.output_text.trim()) {
          return { text: response.output_text.trim(), usage };
        }

        const content = extractOutputText(response);
        if (content) {
          return { text: content, usage };
        }

        throw new Error("OpenAI response did not include output text.");
      } catch (error) {
        clearTimeout(timer);
        logger.warn("OpenAI call attempt failed", { attempt, message: error.message });

        if (attempt >= maxAttempts) {
          throw new AppError("OpenAI generation failed after retries.", 502, {
            message: error.message
          });
        }

        await sleep(350 * attempt);
      }
    }

    throw new AppError("OpenAI generation failed unexpectedly.", 502);
  }

  async generateStream({ systemPrompt, userPrompt, override = {}, onToken, onToolEvent, tools }) {
    this.assertReady();

    const model = override.model || this.config.model;
    const maxOutputTokens = override.maxOutputTokens || this.config.maxOutputTokens;
    const reasoningEffort = override.reasoningEffort || this.config.reasoningEffort;

    let attempt = 0;
    const maxAttempts = Math.max(1, this.config.retries + 1);

    while (attempt < maxAttempts) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const stream = await this.client.responses.create(
          {
            model,
            instructions: systemPrompt,
            input: userPrompt,
            max_output_tokens: maxOutputTokens,
            reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
            stream: true,
            ...(tools && tools.length > 0 ? { tools } : {})
          },
          { signal: controller.signal }
        );

        let fullText = "";
        let usage = null;

        for await (const event of stream) {
          if (event.type === "response.output_text.delta") {
            fullText += event.delta;
            if (onToken) onToken(event.delta);
          } else if (event.type === "response.completed") {
            usage = event.response && event.response.usage ? event.response.usage : null;
          } else if (event.type === "response.web_search_call.searching") {
            if (onToolEvent) onToolEvent({ type: "web_search", status: "searching" });
          } else if (event.type === "response.web_search_call.completed") {
            if (onToolEvent) onToolEvent({ type: "web_search", status: "completed" });
          }
        }

        clearTimeout(timer);

        if (!fullText.trim()) {
          throw new Error("OpenAI stream did not produce output text.");
        }

        return { text: fullText.trim(), usage };
      } catch (error) {
        clearTimeout(timer);
        logger.warn("OpenAI stream attempt failed", { attempt, message: error.message });

        if (attempt >= maxAttempts) {
          throw new AppError("OpenAI streaming failed after retries.", 502, {
            message: error.message
          });
        }

        await sleep(350 * attempt);
      }
    }

    throw new AppError("OpenAI streaming failed unexpectedly.", 502);
  }
}

function extractOutputText(response) {
  const out = response && Array.isArray(response.output) ? response.output : [];
  const parts = [];

  for (const item of out) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const block of content) {
      if (block.type === "output_text" && block.text) {
        parts.push(block.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { OpenAIService };
