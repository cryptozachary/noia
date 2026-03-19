#!/usr/bin/env node
/**
 * Migrate data from FileStore (data/) to SQLite database.
 *
 * Usage:
 *   node scripts/migrate-to-sqlite.js [--db path/to/noia.db]
 *
 * Reads from data/ directory (FileStore layout), writes to SQLite.
 * Safe to run multiple times — uses INSERT OR REPLACE.
 */

const fs = require("fs/promises");
const path = require("path");
const { config } = require("../src/config");

async function readJsonSafe(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readTextSafe(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function listDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function migrate() {
  const dbPath = process.argv.includes("--db")
    ? process.argv[process.argv.indexOf("--db") + 1]
    : path.join(config.dataDir, "noia.db");

  const dataDir = config.dataDir;

  console.log(`Migrating from: ${dataDir}`);
  console.log(`Migrating to:   ${dbPath}`);

  const { SqliteStore } = require("../src/storage/sqliteStore");
  const store = new SqliteStore(dbPath);

  const counts = { runs: 0, agents: 0, sessions: 0, templates: 0, users: 0, documents: 0, snapshots: 0 };

  // ── Runs ──
  const runsDir = path.join(dataDir, "runs");
  const runEntries = await listDir(runsDir);
  for (const entry of runEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".meta.json")) continue;
    const run = await readJsonSafe(path.join(runsDir, entry.name));
    if (!run || !run.id) continue;
    await store.saveRun(run);
    counts.runs++;
  }
  console.log(`  Runs: ${counts.runs}`);

  // ── Agents ──
  const agentsDir = path.join(dataDir, "agents");
  const agentEntries = await listDir(agentsDir);
  for (const entry of agentEntries) {
    if (!entry.isDirectory()) continue;
    const agentId = entry.name;
    const agentDir = path.join(agentsDir, agentId);
    const identity = await readTextSafe(path.join(agentDir, "identity.md"));
    const system = await readTextSafe(path.join(agentDir, "system.md"));
    const memory = await readTextSafe(path.join(agentDir, "memory.md"));
    const agentConfig = await readJsonSafe(path.join(agentDir, "config.json"));

    await store.createAgent(agentId, { identity, system, memory });
    if (agentConfig) {
      await store.saveAgentConfig(agentId, agentConfig);
    }
    counts.agents++;

    // Sessions
    const sessionsDir = path.join(agentDir, "sessions");
    const sessionEntries = await listDir(sessionsDir);
    for (const sEntry of sessionEntries) {
      if (!sEntry.isFile() || !sEntry.name.endsWith(".json")) continue;
      const session = await readJsonSafe(path.join(sessionsDir, sEntry.name));
      if (!session || !session.runId) continue;
      for (const sessionEntry of (session.entries || [])) {
        await store.appendAgentSessionEntry(agentId, session.runId, sessionEntry);
      }
      counts.sessions++;
    }

    // Snapshots
    const snapshotsDir = path.join(agentDir, "snapshots");
    const snapEntries = await listDir(snapshotsDir);
    for (const sEntry of snapEntries) {
      if (!sEntry.isFile() || !sEntry.name.endsWith(".json")) continue;
      const snapshot = await readJsonSafe(path.join(snapshotsDir, sEntry.name));
      if (!snapshot || !snapshot.id) continue;
      await store.saveSnapshot(agentId, snapshot);
      counts.snapshots++;
    }
  }
  console.log(`  Agents: ${counts.agents}`);
  console.log(`  Sessions: ${counts.sessions}`);
  console.log(`  Snapshots: ${counts.snapshots}`);

  // ── Templates ──
  const templatesDir = path.join(dataDir, "templates");
  const tmplEntries = await listDir(templatesDir);
  for (const entry of tmplEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const tmpl = await readJsonSafe(path.join(templatesDir, entry.name));
    if (!tmpl || !tmpl.id) continue;
    store.db.prepare("INSERT OR REPLACE INTO templates (id, name, data, created_at) VALUES (?, ?, ?, ?)")
      .run(tmpl.id, tmpl.name || "Untitled", JSON.stringify(tmpl), tmpl.createdAt || new Date().toISOString());
    counts.templates++;
  }
  console.log(`  Templates: ${counts.templates}`);

  // ── Users ──
  const usersDir = path.join(dataDir, "users");
  const userEntries = await listDir(usersDir);
  for (const entry of userEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const user = await readJsonSafe(path.join(usersDir, entry.name));
    if (!user || !user.id) continue;
    store.db.prepare("INSERT OR REPLACE INTO users (id, name, api_key, created_at) VALUES (?, ?, ?, ?)")
      .run(user.id, user.name || "User", user.apiKey, user.createdAt || new Date().toISOString());
    counts.users++;
  }
  console.log(`  Users: ${counts.users}`);

  // ── Documents ──
  const docsDir = path.join(dataDir, "documents");
  const docEntries = await listDir(docsDir);
  for (const entry of docEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const doc = await readJsonSafe(path.join(docsDir, entry.name));
    if (!doc || !doc.id) continue;
    await store.saveDocument(doc.id, doc);
    counts.documents++;
  }
  console.log(`  Documents: ${counts.documents}`);

  store.close();
  console.log("\nMigration complete.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
