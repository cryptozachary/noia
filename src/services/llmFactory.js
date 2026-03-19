const { OpenAIService } = require("./openaiService");
const { AnthropicService } = require("./anthropicService");

function createLLMService(config) {
  const provider = (config.llmProvider || "openai").toLowerCase();

  if (provider === "anthropic") {
    return new AnthropicService(config.anthropic);
  }

  return new OpenAIService(config.openai);
}

function createLLMServiceForProvider(provider, config) {
  const p = (provider || "").toLowerCase();

  if (p === "anthropic") {
    return new AnthropicService(config.anthropic);
  }

  return new OpenAIService(config.openai);
}

module.exports = { createLLMService, createLLMServiceForProvider };
