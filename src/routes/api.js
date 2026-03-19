const express = require("express");
const { randomUUID } = require("crypto");
const { config } = require("../config");
const { FileStore } = require("../storage/fileStore");
const { createLLMService, createLLMServiceForProvider } = require("../services/llmFactory");
const { validateDiscussionRequest } = require("../services/outputValidator");
const { AppError } = require("../utils/errors");
const { DiscussionOrchestrator } = require("../orchestrator/discussionOrchestrator");
const { AGENTS, getAgent, addAgent, removeAgent, DEFAULT_AGENTS } = require("../agents/registry");
const { startRun, cancelRun, resumeRun, getPausedState, getRunEmitter, getActiveRunIds } = require("../orchestrator/runManager");
const { buildMarkdownExport, buildHtmlExport } = require("../services/exportBuilder");
const { ResearchService } = require("../services/researchService");
const { calculateCost, estimateRunCost, formatCost } = require("../services/costCalculator");
const { EmbeddingService, chunkMemory, truncateEmbedding } = require("../services/embeddingService");

const router = express.Router();

const store = new FileStore(config.dataDir);
const llmService = createLLMService(config);
const researchService = new ResearchService(config.search);
const embeddingService = new EmbeddingService({ apiKey: config.openai.apiKey, embeddingModel: config.embedding.model });
const orchestrator = new DiscussionOrchestrator({
  store,
  openaiService: llmService,
  researchService,
  defaultModel: config.llmProvider === "anthropic" ? config.anthropic.model : config.openai.model,
  fullConfig: config,
  embeddingService
});

function validatePathParam(value) {
  if (!value || /[/\\]|\.\./.test(value)) {
    throw new AppError("Invalid parameter.", 400);
  }
}

router.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

router.get("/runs", async (_req, res, next) => {
  try {
    const runs = await store.listRuns();
    res.json({ runs });
  } catch (error) {
    next(error);
  }
});

router.get("/runs/compare", async (req, res, next) => {
  try {
    const idA = req.query.a;
    const idB = req.query.b;
    if (!idA || !idB) throw new AppError("Both run IDs (a, b) are required.", 400);
    validatePathParam(idA);
    validatePathParam(idB);
    const [runA, runB] = await Promise.all([store.loadRun(idA), store.loadRun(idB)]);
    let divergenceRound = null;
    if (runA.branchedFrom && runA.branchedFrom.runId === idB) {
      divergenceRound = runA.branchedFrom.round;
    } else if (runB.branchedFrom && runB.branchedFrom.runId === idA) {
      divergenceRound = runB.branchedFrom.round;
    }
    const costA = runA.metadata ? calculateCost(runA.metadata.model, runA.metadata.tokenUsage) : null;
    const costB = runB.metadata ? calculateCost(runB.metadata.model, runB.metadata.tokenUsage) : null;
    res.json({ runA: { run: runA, cost: costA }, runB: { run: runB, cost: costB }, divergenceRound });
  } catch (error) {
    next(error);
  }
});

router.delete("/runs/:runId", async (req, res, next) => {
  try {
    validatePathParam(req.params.runId);
    if (getActiveRunIds().includes(req.params.runId)) {
      throw new AppError("Cannot delete an active run. Cancel it first.", 400);
    }
    await store.deleteRun(req.params.runId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/runs/:runId", async (req, res, next) => {
  try {
    validatePathParam(req.params.runId);
    const run = await store.loadRun(req.params.runId);
    const cost = run.metadata ? calculateCost(run.metadata.model, run.metadata.tokenUsage) : null;
    res.json({ run, cost });
  } catch (error) {
    next(error);
  }
});

router.get("/cost/estimate", (req, res) => {
  const model = req.query.model || config.openai.model;
  const topicLength = parseInt(req.query.topicLength, 10) || 200;
  const rounds = parseInt(req.query.rounds, 10) || 4;
  const agentCount = parseInt(req.query.agentCount, 10) || 3;
  const estimate = estimateRunCost(model, topicLength, rounds, agentCount);
  res.json({ estimate });
});

router.post("/discussions", async (req, res, next) => {
  try {
    const valid = validateDiscussionRequest(req.body || {});
    const settings = req.body && req.body.settings ? req.body.settings : {};

    const run = await store.createRunRecord({
      topic: valid.topic,
      title: valid.title,
      rounds: valid.rounds,
      settings
    });

    run.metadata = {
      status: "running",
      medicalTopic: false,
      model: settings.model || config.openai.model,
      tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
    };
    await store.saveRun(run);

    startRun(run.id, orchestrator, {
      topic: valid.topic,
      title: valid.title,
      rounds: valid.rounds,
      stages: valid.stages || null,
      settings,
      existingRun: run
    });

    res.status(202).json({ runId: run.id });
  } catch (error) {
    next(error);
  }
});

router.get("/discussions/active", (_req, res) => {
  res.json({ activeRunIds: getActiveRunIds() });
});

router.delete("/discussions/:runId", (req, res) => {
  const { runId } = req.params;
  const cancelled = cancelRun(runId);
  if (!cancelled) {
    return res.status(404).json({ error: "Run not found or already completed." });
  }
  res.json({ ok: true, runId });
});

router.get("/discussions/:runId/stream", (req, res) => {
  const { runId } = req.params;
  const emitter = getRunEmitter(runId);

  if (!emitter) {
    return res.status(404).json({ error: "Run not found or already completed." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onTitleUpdate = (d) => send("title-update", d);
  const onResearchStart = (d) => send("research-start", d);
  const onResearchComplete = (d) => send("research-complete", d);
  const onRoundStart = (d) => send("round-start", d);
  const onAgentResponse = (d) => send("agent-response", d);
  const onAgentToken = (d) => send("agent-token", d);
  const onCoordinatorToken = (d) => send("coordinator-token", d);
  const onToolEvent = (d) => send("tool-event", d);
  const onRoundComplete = (d) => send("round-complete", d);
  const onRoundPaused = (d) => send("round-paused", d);
  const onRoundResumed = (d) => send("round-resumed", d);
  const onFinalReport = (d) => send("final-report", d);
  const onMemoryUpdateStart = (d) => send("memory-update-start", d);
  const onMemoryUpdateComplete = (d) => send("memory-update-complete", d);
  const onCompressionStart = (d) => send("compression-start", d);
  const onCompressionComplete = (d) => send("compression-complete", d);
  const onEvaluationStart = (d) => send("evaluation-start", d);
  const onEvaluationComplete = (d) => send("evaluation-complete", d);
  const onRunComplete = (d) => { send("run-complete", d); cleanup(); };
  const onRunCancelled = (d) => { send("run-cancelled", d); cleanup(); };
  const onError = (d) => { send("error", d); cleanup(); };

  emitter.on("title-update", onTitleUpdate);
  emitter.on("research-start", onResearchStart);
  emitter.on("research-complete", onResearchComplete);
  emitter.on("round-start", onRoundStart);
  emitter.on("agent-response", onAgentResponse);
  emitter.on("agent-token", onAgentToken);
  emitter.on("coordinator-token", onCoordinatorToken);
  emitter.on("tool-event", onToolEvent);
  emitter.on("round-complete", onRoundComplete);
  emitter.on("round-paused", onRoundPaused);
  emitter.on("round-resumed", onRoundResumed);
  emitter.on("final-report", onFinalReport);
  emitter.on("memory-update-start", onMemoryUpdateStart);
  emitter.on("memory-update-complete", onMemoryUpdateComplete);
  emitter.on("compression-start", onCompressionStart);
  emitter.on("compression-complete", onCompressionComplete);
  emitter.on("evaluation-start", onEvaluationStart);
  emitter.on("evaluation-complete", onEvaluationComplete);
  emitter.on("run-complete", onRunComplete);
  emitter.on("run-cancelled", onRunCancelled);
  emitter.on("error", onError);

  // Reconnect support: if run is paused, immediately notify client
  const pausedState = getPausedState(runId);
  if (pausedState && pausedState.isPaused) {
    send("round-paused", { round: pausedState.pausedAfterRound, nextRound: pausedState.pausedAfterRound + 1 });
  }

  let closed = false;
  function cleanup() {
    if (closed) return;
    closed = true;
    emitter.off("title-update", onTitleUpdate);
    emitter.off("research-start", onResearchStart);
    emitter.off("research-complete", onResearchComplete);
    emitter.off("round-start", onRoundStart);
    emitter.off("agent-response", onAgentResponse);
    emitter.off("agent-token", onAgentToken);
    emitter.off("coordinator-token", onCoordinatorToken);
    emitter.off("tool-event", onToolEvent);
    emitter.off("round-complete", onRoundComplete);
    emitter.off("round-paused", onRoundPaused);
    emitter.off("round-resumed", onRoundResumed);
    emitter.off("final-report", onFinalReport);
    emitter.off("memory-update-start", onMemoryUpdateStart);
    emitter.off("memory-update-complete", onMemoryUpdateComplete);
    emitter.off("compression-start", onCompressionStart);
    emitter.off("compression-complete", onCompressionComplete);
    emitter.off("evaluation-start", onEvaluationStart);
    emitter.off("evaluation-complete", onEvaluationComplete);
    emitter.off("run-complete", onRunComplete);
    emitter.off("run-cancelled", onRunCancelled);
    emitter.off("error", onError);
    res.end();
  }

  req.on("close", cleanup);
});

router.post("/discussions/:runId/input", (req, res) => {
  const userInput = typeof req.body.input === "string" ? req.body.input.trim() : "";
  if (!userInput) return res.status(400).json({ error: "Input text is required." });
  const resumed = resumeRun(req.params.runId, userInput);
  if (!resumed) return res.status(404).json({ error: "Run not found or not paused." });
  res.json({ ok: true });
});

router.get("/agents", async (_req, res, next) => {
  try {
    const ids = await store.listAgents();
    const agents = [];

    for (const id of ids) {
      const meta = getAgent(id);
      const memory = await store.readAgentMemory(id);
      agents.push({
        id,
        name: meta ? meta.name : id,
        purpose: meta ? meta.purpose : "",
        memory
      });
    }

    agents.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ agents, roster: AGENTS });
  } catch (error) {
    next(error);
  }
});

router.get("/agents/:agentId/memory", async (req, res, next) => {
  try {
    validatePathParam(req.params.agentId);
    const memory = await store.readAgentMemory(req.params.agentId);
    res.json({ agentId: req.params.agentId, memory });
  } catch (error) {
    next(error);
  }
});

router.put("/agents/:agentId/memory", async (req, res, next) => {
  try {
    validatePathParam(req.params.agentId);
    const memory = typeof req.body.memory === "string" ? req.body.memory : "";
    await store.writeAgentMemory(req.params.agentId, memory);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/agents/:agentId/insights", async (req, res, next) => {
  try {
    validatePathParam(req.params.agentId);
    const { analyzeMemory } = require("../services/memoryAnalyzer");
    const memory = await store.readAgentMemory(req.params.agentId);
    const insights = analyzeMemory(memory);
    insights.sessionCount = await store.countAgentSessions(req.params.agentId);
    res.json({ agentId: req.params.agentId, insights });
  } catch (error) {
    next(error);
  }
});

router.post("/agents/:agentId/reindex-memory", async (req, res, next) => {
  try {
    validatePathParam(req.params.agentId);
    if (!embeddingService.isAvailable()) {
      throw new AppError("Embedding service not available (no OpenAI API key).", 400);
    }
    const memory = await store.readAgentMemory(req.params.agentId);
    const chunks = chunkMemory(memory);
    if (chunks.length === 0) {
      return res.json({ ok: true, chunks: 0 });
    }
    const embeddings = await embeddingService.embedBatch(chunks);
    await store.saveMemoryEmbeddings(req.params.agentId, {
      agentId: req.params.agentId,
      model: embeddingService.model,
      updatedAt: new Date().toISOString(),
      chunks: chunks.map((text, i) => ({ text, embedding: truncateEmbedding(embeddings[i]) }))
    });
    res.json({ ok: true, chunks: chunks.length });
  } catch (error) {
    next(error);
  }
});

router.get("/agents/:agentId/config", async (req, res, next) => {
  try {
    validatePathParam(req.params.agentId);
    const agent = await store.loadAgent(req.params.agentId);
    res.json({ agent });
  } catch (error) {
    next(error);
  }
});

router.post("/agents", async (req, res, next) => {
  try {
    const name = (req.body.name || "").trim();
    if (!name) throw new AppError("Agent name is required.", 400);

    const agentId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!agentId) throw new AppError("Invalid agent name.", 400);

    const builtInIds = DEFAULT_AGENTS.map((a) => a.id);
    if (builtInIds.includes(agentId)) throw new AppError("Cannot overwrite built-in agents.", 400);

    await store.createAgent(agentId, {
      identity: req.body.identity || `# ${name}\n`,
      system: req.body.system || `You are the ${name} agent.\n`,
      memory: req.body.memory || "# Memory\n"
    });

    if (req.body.model) {
      await store.saveAgentConfig(agentId, { model: req.body.model });
    }

    const agentDef = {
      id: agentId,
      name,
      shortName: name.split(" ").pop(),
      purpose: req.body.purpose || "Custom agent",
      color: "var(--agent-custom)"
    };
    addAgent(agentDef);

    res.status(201).json({ ok: true, agentId, agent: agentDef });
  } catch (error) {
    next(error);
  }
});

router.delete("/agents/:agentId", async (req, res, next) => {
  try {
    validatePathParam(req.params.agentId);
    const builtInIds = DEFAULT_AGENTS.map((a) => a.id);
    if (builtInIds.includes(req.params.agentId)) {
      return res.status(400).json({ error: "Cannot delete built-in agents." });
    }
    removeAgent(req.params.agentId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.put("/agents/:agentId/config", async (req, res, next) => {
  try {
    validatePathParam(req.params.agentId);
    const agentId = req.params.agentId;
    const model = (req.body.model || "").trim();
    const agentConfig = model ? { model } : {};
    await store.saveAgentConfig(agentId, agentConfig);
    res.json({ ok: true, config: agentConfig });
  } catch (error) {
    next(error);
  }
});

router.get("/runs/:runId/export/md", async (req, res, next) => {
  try {
    validatePathParam(req.params.runId);
    const run = await store.loadRun(req.params.runId);
    const markdown = buildMarkdownExport(run);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${run.id}.md"`);
    res.send(markdown);
  } catch (error) {
    next(error);
  }
});

router.get("/runs/:runId/export/html", async (req, res, next) => {
  try {
    validatePathParam(req.params.runId);
    const run = await store.loadRun(req.params.runId);
    const html = buildHtmlExport(run);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${run.id}.html"`);
    res.send(html);
  } catch (error) {
    next(error);
  }
});

router.post("/runs/:runId/branch", async (req, res, next) => {
  try {
    validatePathParam(req.params.runId);
    const afterRound = Number(req.body.round);
    if (!Number.isInteger(afterRound) || afterRound < 1) {
      throw new AppError("Valid round number is required.", 400);
    }

    const sourceRun = await store.loadRun(req.params.runId);
    const maxRound = Math.max(0, ...(sourceRun.roundMessages || []).map((r) => r.round));
    if (afterRound > maxRound) {
      throw new AppError(`Round ${afterRound} does not exist in this run.`, 400);
    }

    const newRun = await store.cloneRunUpToRound(req.params.runId, afterRound);
    newRun.metadata = {
      status: "running",
      medicalTopic: false,
      model: (sourceRun.metadata && sourceRun.metadata.model) || config.openai.model,
      tokenUsage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
    };
    await store.saveRun(newRun);

    const branchSettings = req.body.settings || sourceRun.settings || {};

    startRun(newRun.id, orchestrator, {
      topic: sourceRun.topic,
      title: newRun.title,
      rounds: sourceRun.rounds,
      settings: branchSettings,
      existingRun: newRun,
      startRound: afterRound + 1
    });

    res.status(202).json({ runId: newRun.id });
  } catch (error) {
    next(error);
  }
});

router.get("/runs/:runId/annotations", async (req, res, next) => {
  try {
    validatePathParam(req.params.runId);
    const data = await store.loadAnnotations(req.params.runId);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/runs/:runId/annotations", async (req, res, next) => {
  try {
    validatePathParam(req.params.runId);
    const text = (req.body.text || "").trim();
    if (!text) throw new AppError("Annotation text is required.", 400);

    const round = req.body.round;
    const agentId = req.body.agentId || null;
    const data = await store.loadAnnotations(req.params.runId);
    const annotation = {
      id: `ann-${randomUUID().slice(0, 8)}`,
      round: round != null ? Number(round) : null,
      agentId,
      text,
      timestamp: new Date().toISOString()
    };
    data.annotations.push(annotation);
    await store.saveAnnotations(req.params.runId, data);
    res.status(201).json({ annotation });
  } catch (error) {
    next(error);
  }
});

router.delete("/runs/:runId/annotations/:annotationId", async (req, res, next) => {
  try {
    validatePathParam(req.params.runId);
    const data = await store.loadAnnotations(req.params.runId);
    const before = data.annotations.length;
    data.annotations = data.annotations.filter((a) => a.id !== req.params.annotationId);
    if (data.annotations.length === before) {
      return res.status(404).json({ error: "Annotation not found." });
    }
    await store.saveAnnotations(req.params.runId, data);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/runs/:runId/evaluation", async (req, res, next) => {
  try {
    validatePathParam(req.params.runId);
    const run = await store.loadRun(req.params.runId);
    const graph = (run.metadata && run.metadata.argumentGraph) || { nodes: [], edges: [] };
    const metrics = (run.metadata && run.metadata.evaluationMetrics) || null;
    res.json({ graph, metrics });
  } catch (error) {
    next(error);
  }
});

router.post("/runs/:runId/evaluate", async (req, res, next) => {
  try {
    validatePathParam(req.params.runId);
    const run = await store.loadRun(req.params.runId);
    if (!run.metadata || run.metadata.status !== "completed") {
      throw new AppError("Can only evaluate completed runs.", 400);
    }
    const { extractClaims } = require("../services/claimExtractor");
    const { buildArgumentGraph, computeMetrics } = require("../services/graphBuilder");
    const override = run.settings || {};
    const claims = await extractClaims(run, llmService, override);
    const graph = await buildArgumentGraph(claims, llmService, override);
    const metrics = computeMetrics(graph, run);
    run.metadata.argumentGraph = graph;
    run.metadata.evaluationMetrics = metrics;
    await store.saveRun(run);
    res.json({ graph, metrics });
  } catch (error) {
    next(error);
  }
});

router.get("/templates", async (_req, res, next) => {
  try {
    const templates = await store.listTemplates();
    res.json({ templates });
  } catch (error) {
    next(error);
  }
});

router.post("/templates", async (req, res, next) => {
  try {
    const name = (req.body.name || "").trim();
    if (!name) throw new AppError("Template name is required.", 400);
    const template = await store.saveTemplate({
      name,
      topic: req.body.topic || "",
      rounds: req.body.rounds || 4,
      stages: req.body.stages || null,
      settings: req.body.settings || {}
    });
    res.status(201).json({ template });
  } catch (error) {
    next(error);
  }
});

router.delete("/templates/:templateId", async (req, res, next) => {
  try {
    validatePathParam(req.params.templateId);
    await store.deleteTemplate(req.params.templateId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
