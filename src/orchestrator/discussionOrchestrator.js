const { getScientistAgentIds, getAgent } = require("../agents/registry");
const { logger } = require("../utils/logger");
const {
  composeScientistPrompt,
  composeCoordinatorFinalPrompt
} = require("../agents/promptComposer");
const {
  ensureAgentResponseStructure,
  ensureFinalReportStructure
} = require("../services/outputValidator");
const {
  isMedicalTopic,
  safetySystemAddendum,
  ensureMedicalDisclaimer
} = require("../services/safety");
const { createLLMServiceForProvider } = require("../services/llmFactory");
const { setPaused } = require("./runManager");

class DiscussionOrchestrator {
  constructor({ store, openaiService, researchService, defaultModel, fullConfig }) {
    this.store = store;
    this.openaiService = openaiService;
    this.researchService = researchService || null;
    this.defaultModel = defaultModel;
    this.fullConfig = fullConfig || null;
  }

  async runDiscussion({ topic, title, rounds, settings = {}, stages = null, emitter = null, existingRun = null, checkCancelled = null, waitForInput = null }) {
    const medicalTopic = isMedicalTopic(topic);
    const effectiveSettings = {
      model: settings.model || this.defaultModel,
      temperature: Number.isFinite(settings.temperature) ? settings.temperature : undefined,
      maxOutputTokens: Number.isFinite(settings.maxOutputTokens) ? settings.maxOutputTokens : undefined,
      reasoningEffort: settings.reasoningEffort || undefined
    };

    const run = existingRun || await this.store.createRunRecord({
      topic,
      title,
      rounds,
      settings: effectiveSettings
    });

    run.metadata = {
      status: "running",
      medicalTopic,
      model: effectiveSettings.model,
      tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
    };

    await this.store.saveRun(run);

    try {
      // Auto-title: generate a short title if none provided
      if (!run.title || run.title === topic) {
        try {
          const generatedTitle = await this.generateTitle(topic, effectiveSettings);
          if (generatedTitle) {
            run.title = generatedTitle;
            await this.store.saveRun(run);
            if (emitter) emitter.emit("title-update", { title: generatedTitle });
          }
        } catch (titleError) {
          logger.warn("Auto-title generation failed, continuing without title", { error: titleError.message });
        }
      }

      const agentConfigs = await this.loadAllAgentConfigs();

      // RAG: fetch research context before discussion begins
      let researchContext = "";
      if (this.researchService && this.researchService.isAvailable()) {
        if (emitter) emitter.emit("research-start", { topic });
        const results = await this.researchService.search(topic);
        researchContext = this.researchService.formatAsContext(results);
        run._researchContext = researchContext;
        if (emitter) emitter.emit("research-complete", { sourceCount: results.length });
      }

      for (let round = 1; round <= rounds; round += 1) {
        if (checkCancelled && checkCancelled()) {
          run.metadata.status = "cancelled";
          run.metadata.cancelledAt = new Date().toISOString();
          await this.store.saveRun(run);
          if (emitter) emitter.emit("run-cancelled", { runId: run.id });
          return run;
        }

        const stage = resolveStage(round, rounds, stages);

        if (stage === "final-synthesis") {
          if (emitter) emitter.emit("round-start", { round, stage, coordinatorPrompt: "Producing final synthesis..." });
          const finalPrompt = composeCoordinatorFinalPrompt({
            topic,
            discussionText: serializeTranscript(run.roundMessages),
            isMedicalTopic: medicalTopic,
            researchContext: run._researchContext || ""
          });

          const coordinatorConfig = agentConfigs.coordinator;
          const coordinatorSystemPrompt = [
            coordinatorConfig.identity,
            coordinatorConfig.system,
            "Coordinator Memory:",
            coordinatorConfig.memory,
            safetySystemAddendum()
          ].join("\n\n");

          const coordOverride = {
            ...effectiveSettings,
            maxOutputTokens: Math.max(effectiveSettings.maxOutputTokens || 0, 4000),
            ...(coordinatorConfig.config && coordinatorConfig.config.model
              ? { model: coordinatorConfig.config.model }
              : {})
          };

          const useStreaming = settings.streaming !== false;
          const globalWebSearch = settings.webSearch === true;
          const coordTools = globalWebSearch ? buildWebSearchTools(this.fullConfig?.llmProvider) : undefined;

          const onCoordToken = emitter ? (token) => {
            emitter.emit("coordinator-token", { round, token });
          } : undefined;
          const onCoordToolEvent = emitter ? (evt) => {
            emitter.emit("tool-event", { round, agentId: "coordinator", ...evt });
          } : undefined;

          let result = useStreaming && typeof this.openaiService.generateStream === "function"
            ? await this.openaiService.generateStream({
                systemPrompt: coordinatorSystemPrompt,
                userPrompt: finalPrompt,
                override: coordOverride,
                onToken: onCoordToken,
                onToolEvent: onCoordToolEvent,
                tools: coordTools
              })
            : await this.openaiService.generate({
                systemPrompt: coordinatorSystemPrompt,
                userPrompt: finalPrompt,
                override: coordOverride,
                tools: coordTools
              });

          accumulateUsage(run.metadata.tokenUsage, result.usage);
          let finalReport = ensureFinalReportStructure(result.text, topic);
          if (medicalTopic) {
            finalReport = ensureMedicalDisclaimer(finalReport);
          }

          run.roundMessages.push({
            round,
            stage,
            coordinatorPrompt: "Produce final synthesis with the 10 required sections.",
            messages: []
          });

          run.finalReport = finalReport;

          await this.store.appendAgentSessionEntry("coordinator", run.id, {
            round,
            stage,
            topic,
            prompt: finalPrompt,
            response: finalReport,
            timestamp: new Date().toISOString()
          });

          await this.store.saveExport(run.id, finalReport);
          await this.store.saveRun(run);
          if (emitter) {
            emitter.emit("final-report", { report: finalReport, tokenUsage: run.metadata.tokenUsage });
            emitter.emit("round-complete", { round });
          }
          continue;
        }

        const customInstruction = stages && stages[round - 1] ? stages[round - 1].instruction : "";
        const coordinatorPrompt = buildCoordinatorPrompt({ topic, round, rounds, stage, customInstruction });
        if (emitter) emitter.emit("round-start", { round, stage, coordinatorPrompt });

        const roundRecord = {
          round,
          stage,
          coordinatorPrompt,
          messages: []
        };

        await this.store.appendAgentSessionEntry("coordinator", run.id, {
          round,
          stage,
          topic,
          prompt: coordinatorPrompt,
          response: "Prompt distributed to scientist agents.",
          timestamp: new Date().toISOString()
        });

        const useStreaming = settings.streaming !== false;
        const globalWebSearch = settings.webSearch === true;

        const agentPromises = getScientistAgentIds().map(async (agentId) => {
          try {
            const config = agentConfigs[agentId];
            const peerMessages = collectPeerMessages(run.roundMessages, agentId);

            const userPrompt = composeScientistPrompt({
              agentId,
              topic,
              roundNumber: round,
              stage,
              peerMessages,
              researchContext: run._researchContext || "",
              stageInstruction: customInstruction,
              userInput: run._userInput || ""
            });

            const systemPrompt = [
              config.identity,
              config.system,
              "Long-term memory:",
              config.memory,
              safetySystemAddendum()
            ].join("\n\n");

            const agentOverride = config.config && config.config.model
              ? { ...effectiveSettings, model: config.config.model }
              : effectiveSettings;

            const agentProvider = config.config && config.config.provider;
            const service = agentProvider && this.fullConfig
              ? createLLMServiceForProvider(agentProvider, this.fullConfig)
              : this.openaiService;

            const agentWebSearch = config.config?.webSearch;
            const useWebSearch = agentWebSearch !== undefined ? agentWebSearch : globalWebSearch;
            const tools = useWebSearch ? buildWebSearchTools(agentProvider || this.fullConfig?.llmProvider) : undefined;

            const onToken = emitter ? (token) => {
              emitter.emit("agent-token", { round, agentId, agentName: getAgent(agentId).name, token });
            } : undefined;
            const onToolEvent = emitter ? (evt) => {
              emitter.emit("tool-event", { round, agentId, ...evt });
            } : undefined;

            const result = useStreaming && typeof service.generateStream === "function"
              ? await service.generateStream({
                  systemPrompt,
                  userPrompt,
                  override: agentOverride,
                  onToken,
                  onToolEvent,
                  tools
                })
              : await service.generate({
                  systemPrompt,
                  userPrompt,
                  override: agentOverride,
                  tools
                });

            accumulateUsage(run.metadata.tokenUsage, result.usage);
            const response = ensureAgentResponseStructure(result.text);

            const message = {
              agentId,
              agentName: getAgent(agentId).name,
              timestamp: new Date().toISOString(),
              content: response,
              tokenUsage: result.usage || null
            };

            if (emitter) emitter.emit("agent-response", {
              round, agentId, agentName: message.agentName,
              content: response, timestamp: message.timestamp,
              tokenUsage: result.usage || null
            });

            await this.store.appendAgentSessionEntry(agentId, run.id, {
              round,
              stage,
              topic,
              coordinatorPrompt,
              prompt: userPrompt,
              response,
              timestamp: message.timestamp
            });

            return message;
          } catch (agentError) {
            logger.warn("Agent failed during round, continuing with fallback", {
              agentId, round, error: agentError.message
            });
            const fallbackContent = ensureAgentResponseStructure("");
            const fallback = {
              agentId,
              agentName: getAgent(agentId)?.name || agentId,
              timestamp: new Date().toISOString(),
              content: fallbackContent,
              tokenUsage: null,
              error: agentError.message
            };
            if (emitter) emitter.emit("agent-response", {
              round, agentId, agentName: fallback.agentName,
              content: fallbackContent, timestamp: fallback.timestamp,
              tokenUsage: null, error: agentError.message
            });
            return fallback;
          }
        });

        const messages = await Promise.all(agentPromises);

        if (checkCancelled && checkCancelled()) {
          run.metadata.status = "cancelled";
          run.metadata.cancelledAt = new Date().toISOString();
          await this.store.saveRun(run);
          if (emitter) emitter.emit("run-cancelled", { runId: run.id });
          return run;
        }

        for (const message of messages) {
          roundRecord.messages.push(message);
        }

        run.roundMessages.push(roundRecord);
        await this.store.saveRun(run);
        if (emitter) emitter.emit("round-complete", { round });

        // Interactive pause: wait for user input before next round
        const shouldPause = settings.interactive === true && round < rounds && stage !== "final-synthesis";
        if (shouldPause && waitForInput) {
          if (emitter) emitter.emit("round-paused", { round, nextRound: round + 1 });
          setPaused(run.id, round);

          const userInput = await waitForInput();

          if (checkCancelled && checkCancelled()) {
            run.metadata.status = "cancelled";
            run.metadata.cancelledAt = new Date().toISOString();
            await this.store.saveRun(run);
            if (emitter) emitter.emit("run-cancelled", { runId: run.id });
            return run;
          }

          run._userInput = userInput || "";
          if (emitter) emitter.emit("round-resumed", { round: round + 1, userInput: run._userInput });
        } else {
          run._userInput = "";
        }
      }

      // Agent memory auto-update (opt-out via settings.autoMemory = false)
      if (settings.autoMemory !== false) {
        try {
          if (emitter) emitter.emit("memory-update-start", { runId: run.id });
          await this.updateAgentMemories(run, agentConfigs, effectiveSettings);
          if (emitter) emitter.emit("memory-update-complete", { runId: run.id });
        } catch (memError) {
          logger.warn("Agent memory auto-update failed", { error: memError.message });
        }
      }

      run.metadata.status = "completed";
      run.metadata.completedAt = new Date().toISOString();
      await this.store.saveRun(run);
      if (emitter) emitter.emit("run-complete", { runId: run.id, tokenUsage: run.metadata.tokenUsage });
      return run;
    } catch (error) {
      run.metadata.status = "failed";
      run.metadata.error = error.message;
      run.metadata.failedAt = new Date().toISOString();
      await this.store.saveRun(run);
      if (emitter) emitter.emit("error", { message: error.message });
      throw error;
    }
  }

  async updateAgentMemories(run, agentConfigs, settings) {
    const agentIds = getScientistAgentIds();

    const results = await Promise.allSettled(
      agentIds.map(async (agentId) => {
        const config = agentConfigs[agentId];
        const agentMessages = [];
        for (const round of run.roundMessages || []) {
          for (const msg of round.messages || []) {
            if (msg.agentId === agentId) {
              agentMessages.push(`Round ${round.round}: ${msg.content}`);
            }
          }
        }

        if (agentMessages.length === 0) return;

        const existingMemory = config.memory || "";
        const result = await this.openaiService.generate({
          systemPrompt: "You are a memory manager. Given an agent's responses from a discussion and their existing memory, produce 2-3 concise new lines to append to their memory. Focus on key learnings, positions taken, and areas for growth. Output ONLY the new lines to append, nothing else.",
          userPrompt: `Agent: ${agentId}\nTopic: ${run.topic}\n\nAgent responses:\n${agentMessages.join("\n\n")}\n\nExisting memory:\n${existingMemory}`,
          override: { ...settings, maxOutputTokens: 150 }
        });

        const newLines = (result.text || "").trim();
        if (newLines) {
          const updated = `${existingMemory.trimEnd()}\n\n## Session: ${run.id}\n${newLines}\n`;
          await this.store.writeAgentMemory(agentId, updated);
        }
      })
    );

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      logger.warn("Some agent memory updates failed", { count: failures.length });
    }
  }

  async generateTitle(topic, settings) {
    const result = await this.openaiService.generate({
      systemPrompt: "You generate short, descriptive titles for scientific discussions. Respond with ONLY the title, no quotes or extra text.",
      userPrompt: `Generate a concise 5-8 word title for a scientific discussion about:\n${topic}`,
      override: { ...settings, maxOutputTokens: 60 }
    });
    const title = (result.text || "").trim().replace(/^["']|["']$/g, "");
    return title || null;
  }

  async loadAllAgentConfigs() {
    const ids = [...getScientistAgentIds(), "coordinator"];
    const configs = {};

    for (const id of ids) {
      configs[id] = await this.store.loadAgent(id);
    }

    return configs;
  }
}

function buildWebSearchTools(provider) {
  const p = (provider || "openai").toLowerCase();
  if (p === "anthropic") {
    return [{ type: "web_search_20250305", name: "web_search" }];
  }
  return [{ type: "web_search_preview" }];
}

function accumulateUsage(totals, usage) {
  if (!usage) return;
  totals.input_tokens += usage.input_tokens || 0;
  totals.output_tokens += usage.output_tokens || 0;
  totals.total_tokens += usage.total_tokens || 0;
}

function resolveStage(round, totalRounds, customStages) {
  if (customStages && customStages[round - 1]) {
    return customStages[round - 1].name;
  }

  if (round === totalRounds) {
    return "final-synthesis";
  }

  if (round === 1) {
    return "initial-positions";
  }

  if (round === 2) {
    return "cross-critique";
  }

  return "convergence";
}

function buildCoordinatorPrompt({ topic, round, rounds, stage, customInstruction }) {
  const base = `Topic: ${topic}. Round ${round} of ${rounds}.`;

  if (customInstruction) {
    return `${base} ${customInstruction}`;
  }

  if (stage === "initial-positions") {
    return `${base} Establish initial framing, risks, and inventive directions.`;
  }

  if (stage === "cross-critique") {
    return `${base} Each scientist must identify strongest point, biggest flaw, and revised idea after critique.`;
  }

  return `${base} Narrow discussion toward top 3 directions, bottlenecks, and next experiments.`;
}

function collectPeerMessages(roundMessages, currentAgentId) {
  const peers = [];

  for (const round of roundMessages) {
    const messages = Array.isArray(round.messages) ? round.messages : [];
    for (const msg of messages) {
      if (msg.agentId !== currentAgentId) {
        peers.push({
          agentName: msg.agentName,
          round: round.round,
          content: msg.content
        });
      }
    }
  }

  return peers.slice(-6);
}

function serializeTranscript(roundMessages) {
  return roundMessages
    .map((round) => {
      const lines = [`Round ${round.round} (${round.stage})`, `Coordinator: ${round.coordinatorPrompt}`];
      for (const msg of round.messages || []) {
        lines.push(`${msg.agentName}: ${msg.content}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

module.exports = { DiscussionOrchestrator };
