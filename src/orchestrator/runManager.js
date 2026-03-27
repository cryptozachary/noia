const { EventEmitter } = require("events");
const { logger } = require("../utils/logger");

const activeRuns = new Map();

function startRun(runId, orchestrator, params) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(30);
  let cancelled = false;
  const checkCancelled = () => cancelled;

  // Interactive input channel
  let inputResolver = null;
  const waitForInput = () => new Promise((resolve) => { inputResolver = resolve; });
  const provideInput = (input) => {
    if (inputResolver) {
      inputResolver(input);
      inputResolver = null;
    }
  };

  const promise = orchestrator
    .runDiscussion({ ...params, emitter, checkCancelled, waitForInput })
    .catch((error) => {
      logger.error("Run failed", { runId, message: error.message });
      emitter.emit("error", { message: error.message });
    })
    .finally(() => {
      setTimeout(() => activeRuns.delete(runId), 30000);
    });

  activeRuns.set(runId, {
    emitter,
    promise,
    userId: params.userId || null,
    isPaused: false,
    pausedAfterRound: null,
    cancel() {
      cancelled = true;
      provideInput("");
    },
    provideInput
  });

  return emitter;
}

function cancelRun(runId) {
  const entry = activeRuns.get(runId);
  if (!entry) return false;
  entry.cancel();
  return true;
}

function getRunEmitter(runId) {
  const entry = activeRuns.get(runId);
  return entry ? entry.emitter : null;
}

function resumeRun(runId, userInput) {
  const entry = activeRuns.get(runId);
  if (!entry || !entry.isPaused) return false;
  entry.isPaused = false;
  entry.pausedAfterRound = null;
  entry.provideInput(userInput || "");
  return true;
}

function setPaused(runId, round) {
  const entry = activeRuns.get(runId);
  if (entry) {
    entry.isPaused = true;
    entry.pausedAfterRound = round;
  }
}

function getPausedState(runId) {
  const entry = activeRuns.get(runId);
  if (!entry) return null;
  return { isPaused: entry.isPaused, pausedAfterRound: entry.pausedAfterRound };
}

function getActiveRunIds(userId) {
  if (!userId) return [...activeRuns.keys()];
  return [...activeRuns.entries()]
    .filter(([, entry]) => entry.userId === userId)
    .map(([id]) => id);
}

function getActiveRunUserId(runId) {
  const entry = activeRuns.get(runId);
  return entry ? entry.userId : null;
}

function shutdownAll() {
  for (const [runId, entry] of activeRuns) {
    entry.cancel();
    logger.info("Cancelled run during shutdown", { runId });
  }
}

module.exports = { startRun, cancelRun, resumeRun, setPaused, getPausedState, getRunEmitter, getActiveRunIds, getActiveRunUserId, shutdownAll };
