const path = require("path");
const fs = require("fs/promises");
const { config } = require("../src/config");
const { ensureBootstrap } = require("../src/storage/bootstrap");
const { FileStore } = require("../src/storage/fileStore");
const {
  ensureFinalReportStructure,
  FINAL_REQUIRED_SECTIONS
} = require("../src/services/outputValidator");

async function main() {
  await ensureBootstrap();

  const store = new FileStore(config.dataDir);

  console.log("[verify] bootstrap ok");

  const run = await store.createRunRecord({
    topic: "Verification topic",
    title: "Verification run",
    rounds: 3,
    settings: { model: "test-model" }
  });

  run.roundMessages.push({
    round: 1,
    stage: "initial-positions",
    coordinatorPrompt: "Test prompt",
    messages: []
  });

  run.finalReport = ensureFinalReportStructure("1. Topic\nVerification topic", "Verification topic");
  run.metadata.status = "completed";

  await store.saveRun(run);
  const loaded = await store.loadRun(run.id);

  assert(loaded.id === run.id, "saved run should be loadable");
  assert(Array.isArray(loaded.roundMessages), "roundMessages should be present");

  await store.appendAgentSessionEntry("research-synthesizer", run.id, {
    round: 1,
    stage: "initial-positions",
    topic: run.topic,
    prompt: "test",
    response: "test",
    timestamp: new Date().toISOString()
  });

  const sessionPath = path.join(config.dataDir, "agents", "research-synthesizer", "sessions", `${run.id}.json`);
  const sessionRaw = await fs.readFile(sessionPath, "utf8");
  const session = JSON.parse(sessionRaw);
  assert(Array.isArray(session.entries) && session.entries.length > 0, "session entries should persist");

  for (const section of FINAL_REQUIRED_SECTIONS) {
    assert(new RegExp(`^${escapeRegExp(section)}`, "m").test(loaded.finalReport), `final report missing section: ${section}`);
  }

  await safeDelete(path.join(config.dataDir, "runs", `${run.id}.json`));
  await safeDelete(sessionPath);

  console.log("[verify] storage load/save ok");
  console.log("[verify] run creation and transcript persistence ok");
  console.log("[verify] output structure validation ok");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function safeDelete(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (_error) {
    // Ignore missing files.
  }
}

main().catch((error) => {
  console.error("[verify] failed:", error.message);
  process.exit(1);
});
