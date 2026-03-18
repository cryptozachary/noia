const express = require("express");
const { config } = require("../config");
const { FileStore } = require("../storage/fileStore");
const { OpenAIService } = require("../services/openaiService");
const { validateDiscussionRequest } = require("../services/outputValidator");
const { DiscussionOrchestrator } = require("../orchestrator/discussionOrchestrator");
const { AGENTS, getAgent } = require("../agents/registry");

const router = express.Router();

const store = new FileStore(config.dataDir);
const openaiService = new OpenAIService(config.openai);
const orchestrator = new DiscussionOrchestrator({
  store,
  openaiService,
  defaultModel: config.openai.model
});

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

router.get("/runs/:runId", async (req, res, next) => {
  try {
    const run = await store.loadRun(req.params.runId);
    res.json({ run });
  } catch (error) {
    next(error);
  }
});

router.post("/discussions", async (req, res, next) => {
  try {
    const valid = validateDiscussionRequest(req.body || {});
    const run = await orchestrator.runDiscussion({
      topic: valid.topic,
      title: valid.title,
      rounds: valid.rounds,
      settings: req.body && req.body.settings ? req.body.settings : {}
    });

    res.status(201).json({ run });
  } catch (error) {
    next(error);
  }
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
    const memory = await store.readAgentMemory(req.params.agentId);
    res.json({ agentId: req.params.agentId, memory });
  } catch (error) {
    next(error);
  }
});

router.put("/agents/:agentId/memory", async (req, res, next) => {
  try {
    const memory = typeof req.body.memory === "string" ? req.body.memory : "";
    await store.writeAgentMemory(req.params.agentId, memory);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/agents/:agentId/config", async (req, res, next) => {
  try {
    const agent = await store.loadAgent(req.params.agentId);
    res.json({ agent });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
