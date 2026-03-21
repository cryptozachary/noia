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
  constructor({ store, openaiService, researchService, defaultModel, fullConfig, embeddingService, memoryPruner, documentService }) {
    this.store = store;
    this.openaiService = openaiService;
    this.researchService = researchService || null;
    this.defaultModel = defaultModel;
    this.fullConfig = fullConfig || null;
    this.embeddingService = embeddingService || null;
    this.memoryPruner = memoryPruner || null;
    this.documentService = documentService || null;
    this.agentRetries = fullConfig?.agentRetries ?? 1;
    this.agentRetryDelayMs = fullConfig?.agentRetryDelayMs ?? 2000;
  }

  async runDiscussion({ topic, title, rounds, settings = {}, stages = null, emitter = null, existingRun = null, checkCancelled = null, waitForInput = null, startRound = 1 }) {
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
    if (!run.roundSummaries) run.roundSummaries = {};
    const compressionEnabled = settings.contextCompression !== false && rounds > 3;

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

      // Vector memory: replace full memory with relevant chunks if embeddings available
      if (this.embeddingService && this.embeddingService.isAvailable()) {
        try {
          const topicEmbedding = await this.embeddingService.embed(topic);
          if (topicEmbedding) {
            for (const [agentId, config] of Object.entries(agentConfigs)) {
              const embData = await this.store.loadMemoryEmbeddings(agentId);
              if (embData && embData.chunks && embData.chunks.length > 0) {
                const relevant = this.embeddingService.searchSimilar(topicEmbedding, embData.chunks, 5);
                if (relevant.length > 0) {
                  config.memory = "Relevant memories:\n" + relevant.map((r) => `- ${r.text}`).join("\n");
                }
              }
            }
          }
        } catch (embError) {
          logger.warn("Vector memory retrieval failed, using full memory", { error: embError.message });
        }
      }

      // RAG: fetch research context before discussion begins
      let researchContext = "";
      if (this.researchService && this.researchService.isAvailable()) {
        if (emitter) emitter.emit("research-start", { topic });
        const results = await this.researchService.search(topic);
        researchContext = this.researchService.formatAsContext(results);
        run._researchContext = researchContext;
        if (results.length > 0) {
          run._researchSources = results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet }));
        }
        if (emitter) emitter.emit("research-complete", { sourceCount: results.length, sources: run._researchSources || [] });
      }

      // Inject document context if documentIds provided
      if (this.documentService && settings.documentIds && settings.documentIds.length > 0) {
        try {
          const docContext = await this.documentService.getDocumentContext(settings.documentIds, topic);
          if (docContext) {
            run._researchContext = (run._researchContext || "") + "\n\n" + docContext;
          }
        } catch (err) {
          logger.warn("Document context injection failed", { error: err.message });
        }
      }

      for (let round = startRound; round <= rounds; round += 1) {
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

          if (result.sources && result.sources.length > 0 && emitter) {
            emitter.emit("tool-event", {
              type: "web_search", status: "sources",
              round, agentId: "coordinator", agentName: "Coordinator",
              sources: result.sources
            });
          }

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
          const maxRetries = this.agentRetries;
          const baseDelay = this.agentRetryDelayMs;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              const config = agentConfigs[agentId];
              const peerContext = collectPeerMessages(run.roundMessages, agentId, compressionEnabled ? (run.roundSummaries || {}) : {});

              const userPrompt = composeScientistPrompt({
                agentId,
                topic,
                roundNumber: round,
                stage,
                peerMessages: peerContext.summary ? undefined : peerContext.recentMessages,
                peerContext: peerContext.summary ? peerContext : undefined,
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

              if (result.sources && result.sources.length > 0 && emitter) {
                emitter.emit("tool-event", {
                  type: "web_search", status: "sources",
                  round, agentId, agentName: message.agentName,
                  sources: result.sources
                });
              }

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
              const isLast = attempt >= maxRetries;
              const transient = isTransientError(agentError);

              if (transient && !isLast) {
                const delay = baseDelay * Math.pow(2, attempt);
                logger.info("Retrying agent after transient error", {
                  agentId, round, attempt: attempt + 1, delay, error: agentError.message
                });
                if (emitter) emitter.emit("agent-retry", {
                  round, agentId, agentName: getAgent(agentId)?.name || agentId,
                  attempt: attempt + 1, maxRetries, error: agentError.message
                });
                await sleep(delay);
                continue;
              }

              logger.warn("Agent failed during round, continuing with fallback", {
                agentId, round, attempt, error: agentError.message
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

        // Context compression: summarize prior rounds to reduce prompt size
        if (compressionEnabled && round >= 2) {
          try {
            if (emitter) emitter.emit("compression-start", { round });
            const summaryText = await this.generateRoundSummary(run, round, effectiveSettings);
            run.roundSummaries[round] = summaryText;
            await this.store.saveRun(run);
            if (emitter) emitter.emit("compression-complete", { round });
          } catch (compError) {
            logger.warn("Context compression failed, using raw messages", { round, error: compError.message });
          }
        }

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

          // Auto-prune if memory has grown beyond threshold
          if (this.memoryPruner) {
            const threshold = this.fullConfig?.memoryPrune?.autoThreshold ?? 30;
            for (const agentId of getScientistAgentIds()) {
              try {
                const shouldPrune = await this.memoryPruner.shouldAutoPrune(agentId, threshold);
                if (shouldPrune) {
                  logger.info("Auto-pruning agent memory", { agentId, threshold });
                  await this.memoryPruner.pruneAgentMemory(agentId);
                }
              } catch (pruneErr) {
                logger.warn("Auto-prune failed", { agentId, error: pruneErr.message });
              }
            }
          }
        } catch (memError) {
          logger.warn("Agent memory auto-update failed", { error: memError.message });
        }
      }

      // Post-run evaluation: extract claims, build graph, compute metrics
      try {
        if (emitter) emitter.emit("evaluation-start", { runId: run.id });
        const { extractClaims } = require("../services/claimExtractor");
        const { buildArgumentGraph, computeMetrics } = require("../services/graphBuilder");
        const claims = await extractClaims(run, this.openaiService, effectiveSettings);
        const graph = await buildArgumentGraph(claims, this.openaiService, effectiveSettings);
        const metrics = computeMetrics(graph, run);
        run.metadata.argumentGraph = graph;
        run.metadata.evaluationMetrics = metrics;
        await this.store.saveRun(run);
        if (emitter) emitter.emit("evaluation-complete", { metrics, graph });
      } catch (evalError) {
        logger.warn("Post-run evaluation failed", { error: evalError.message });
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

          // Reindex embeddings for this agent's memory
          if (this.embeddingService && this.embeddingService.isAvailable()) {
            try {
              const { chunkMemory, truncateEmbedding } = require("../services/embeddingService");
              const chunks = chunkMemory(updated);
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
              logger.warn("Failed to index memory embeddings", { agentId, error: embErr.message });
            }
          }
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

  async generateRoundSummary(run, upToRound, settings) {
    const roundsToSummarize = run.roundMessages.filter((r) => r.round <= upToRound);
    const transcript = serializeTranscript(roundsToSummarize);

    const result = await this.openaiService.generate({
      systemPrompt: "You summarize scientific discussion rounds. Produce a concise summary that preserves: key positions taken by each agent, main points of agreement, main disagreements, and any revised views. Keep it under 400 words. Output ONLY the summary.",
      userPrompt: `Summarize the following discussion rounds:\n\n${transcript}`,
      override: { ...settings, maxOutputTokens: 500 }
    });

    accumulateUsage(run.metadata.tokenUsage, result.usage);
    return (result.text || "").trim();
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

function collectPeerMessages(roundMessages, currentAgentId, roundSummaries = {}) {
  const latestRound = Math.max(0, ...roundMessages.map((r) => r.round));

  // Find the most recent summary covering prior rounds
  const summaryKeys = Object.keys(roundSummaries).map(Number).sort((a, b) => b - a);
  const summaryRound = summaryKeys.find((k) => k < latestRound);
  const summaryText = summaryRound ? roundSummaries[summaryRound] : null;

  if (summaryText) {
    // Use summary for older rounds, raw messages only for latest round
    const recentMessages = [];
    for (const round of roundMessages) {
      if (round.round === latestRound) {
        for (const msg of round.messages || []) {
          if (msg.agentId !== currentAgentId) {
            recentMessages.push({ agentName: msg.agentName, round: round.round, content: msg.content });
          }
        }
      }
    }
    return { summary: summaryText, recentMessages };
  }

  // Fallback: original behavior — all peer messages, last 6
  const peers = [];
  for (const round of roundMessages) {
    for (const msg of round.messages || []) {
      if (msg.agentId !== currentAgentId) {
        peers.push({ agentName: msg.agentName, round: round.round, content: msg.content });
      }
    }
  }
  return { summary: null, recentMessages: peers.slice(-6) };
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

function isTransientError(error) {
  const code = error.statusCode || error.status || 0;
  if (code === 429 || code >= 500) return true;
  const msg = (error.message || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("econnreset") || msg.includes("enotfound")) return true;
  if (msg.includes("rate limit") || msg.includes("rate_limit")) return true;
  if (error.code === "ECONNRESET" || error.code === "ETIMEDOUT" || error.code === "ENOTFOUND") return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { DiscussionOrchestrator, collectPeerMessages, isTransientError };
