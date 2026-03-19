const Database = require("better-sqlite3");
const { randomUUID } = require("crypto");
const { AppError } = require("../utils/errors");

class SqliteStore {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this._initSchema();
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        title TEXT,
        topic TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        user_id TEXT,
        branched_from TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        identity TEXT NOT NULL DEFAULT '',
        system TEXT NOT NULL DEFAULT '',
        memory TEXT NOT NULL DEFAULT '',
        config TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS agent_sessions (
        agent_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT,
        PRIMARY KEY(agent_id, run_id)
      );

      CREATE TABLE IF NOT EXISTS memory_embeddings (
        agent_id TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS annotations (
        run_id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY(run_id)
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        label TEXT,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_agent ON snapshots(agent_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_key TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_users_key ON users(api_key);

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  // ── Utility methods (match FileStore interface) ──

  async readText(_filePath, fallback = "") {
    return fallback;
  }

  async writeText(_filePath, _content) {
    // No-op for SQL store; methods that need this call specific table methods
  }

  async readJson(_filePath, fallback = null) {
    return fallback;
  }

  async writeJson(_filePath, _data) {
    // No-op
  }

  // ── Run methods ──

  runPath() { return ""; }
  runMetaPath() { return ""; }

  async createRunRecord({ topic, title, rounds, settings, userId }) {
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const record = {
      id: runId, title, topic,
      createdAt: now, updatedAt: now,
      settings, rounds,
      roundMessages: [], finalReport: "",
      metadata: { status: "running" }
    };
    if (userId) record.userId = userId;
    return record;
  }

  async saveRun(run) {
    run.updatedAt = new Date().toISOString();
    const status = run.metadata?.status || "unknown";
    const branchedFrom = run.branchedFrom ? JSON.stringify(run.branchedFrom) : null;

    this.db.prepare(`
      INSERT OR REPLACE INTO runs (id, title, topic, status, user_id, branched_from, created_at, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id, run.title || null, run.topic, status,
      run.userId || null, branchedFrom,
      run.createdAt, run.updatedAt, JSON.stringify(run)
    );
  }

  async loadRun(runId) {
    const row = this.db.prepare("SELECT data FROM runs WHERE id = ?").get(runId);
    if (!row) throw new AppError(`Run not found: ${runId}`, 404);
    return JSON.parse(row.data);
  }

  async listRuns({ page = 1, limit = 50 } = {}) {
    const total = this.db.prepare("SELECT COUNT(*) as cnt FROM runs").get().cnt;
    const offset = (page - 1) * limit;
    const rows = this.db.prepare(
      "SELECT id, title, topic, status, user_id, branched_from, created_at, updated_at FROM runs ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).all(limit, offset);

    const runs = rows.map((r) => {
      const meta = { id: r.id, title: r.title, topic: r.topic, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
      if (r.user_id) meta.userId = r.user_id;
      if (r.branched_from) {
        try { meta.branchedFrom = JSON.parse(r.branched_from); } catch { /* skip */ }
      }
      return meta;
    });

    return { runs, total, page, limit };
  }

  async deleteRun(runId) {
    this.db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
    this.db.prepare("DELETE FROM annotations WHERE run_id = ?").run(runId);
    this.db.prepare("DELETE FROM agent_sessions WHERE run_id = ?").run(runId);
  }

  // ── Agent methods ──

  agentPath(_agentId, _fileName) { return ""; }

  async loadAgent(agentId) {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
    if (!row) throw new AppError(`Agent configuration missing for ${agentId}`, 500);
    return {
      agentId: row.id,
      identity: row.identity,
      system: row.system,
      memory: row.memory,
      config: JSON.parse(row.config || "{}")
    };
  }

  async loadAgentConfig(agentId) {
    const row = this.db.prepare("SELECT config FROM agents WHERE id = ?").get(agentId);
    return row ? JSON.parse(row.config || "{}") : {};
  }

  async saveAgentConfig(agentId, agentConfig) {
    this.db.prepare("UPDATE agents SET config = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(agentConfig), new Date().toISOString(), agentId);
  }

  async listAgents() {
    return this.db.prepare("SELECT id FROM agents ORDER BY id").all().map((r) => r.id);
  }

  async readAgentMemory(agentId) {
    const row = this.db.prepare("SELECT memory FROM agents WHERE id = ?").get(agentId);
    return row ? row.memory : "";
  }

  async writeAgentMemory(agentId, content) {
    this.db.prepare("UPDATE agents SET memory = ?, updated_at = ? WHERE id = ?")
      .run(content, new Date().toISOString(), agentId);
  }

  async appendAgentSessionEntry(agentId, runId, entry) {
    const row = this.db.prepare("SELECT data FROM agent_sessions WHERE agent_id = ? AND run_id = ?").get(agentId, runId);
    let session;
    if (row) {
      session = JSON.parse(row.data);
    } else {
      session = { runId, agentId, createdAt: new Date().toISOString(), entries: [] };
    }
    session.entries.push(entry);
    session.updatedAt = new Date().toISOString();

    this.db.prepare(`
      INSERT OR REPLACE INTO agent_sessions (agent_id, run_id, data, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(agentId, runId, JSON.stringify(session), session.updatedAt);
  }

  async createAgent(agentId, { identity, system, memory }) {
    this.db.prepare(`
      INSERT OR REPLACE INTO agents (id, identity, system, memory, config, updated_at)
      VALUES (?, ?, ?, ?, '{}', ?)
    `).run(agentId, identity || `# ${agentId}\n`, system || "You are a custom agent.\n", memory || "# Memory\n", new Date().toISOString());
  }

  // ── Annotations ──

  annotationsPath() { return ""; }

  async loadAnnotations(runId) {
    const row = this.db.prepare("SELECT data FROM annotations WHERE run_id = ?").get(runId);
    return row ? JSON.parse(row.data) : { runId, annotations: [] };
  }

  async saveAnnotations(runId, data) {
    this.db.prepare("INSERT OR REPLACE INTO annotations (run_id, data) VALUES (?, ?)").run(runId, JSON.stringify(data));
  }

  async deleteAnnotationsForRun(runId) {
    this.db.prepare("DELETE FROM annotations WHERE run_id = ?").run(runId);
  }

  // ── Embeddings ──

  async loadMemoryEmbeddings(agentId) {
    const row = this.db.prepare("SELECT data FROM memory_embeddings WHERE agent_id = ?").get(agentId);
    return row ? JSON.parse(row.data) : null;
  }

  async saveMemoryEmbeddings(agentId, data) {
    this.db.prepare("INSERT OR REPLACE INTO memory_embeddings (agent_id, data) VALUES (?, ?)").run(agentId, JSON.stringify(data));
  }

  // ── Branching ──

  async cloneRunUpToRound(sourceRunId, afterRound) {
    const source = await this.loadRun(sourceRunId);
    const newRun = await this.createRunRecord({
      topic: source.topic,
      title: source.title ? `${source.title} (branch)` : source.title,
      rounds: source.rounds,
      settings: source.settings || {}
    });
    newRun.roundMessages = (source.roundMessages || []).filter((r) => r.round <= afterRound);
    newRun.branchedFrom = { runId: sourceRunId, round: afterRound };
    newRun._researchContext = source._researchContext || "";
    return newRun;
  }

  // ── Exports ──

  async saveExport(_runId, _markdownText) {
    // In SQLite mode, export is stored within the run data itself
    // No separate file needed
  }

  // ── Templates ──

  async listTemplates() {
    const rows = this.db.prepare("SELECT data FROM templates ORDER BY created_at DESC").all();
    return rows.map((r) => JSON.parse(r.data));
  }

  async loadTemplate(templateId) {
    const row = this.db.prepare("SELECT data FROM templates WHERE id = ?").get(templateId);
    if (!row) throw new AppError(`Template not found: ${templateId}`, 404);
    return JSON.parse(row.data);
  }

  async saveTemplate({ name, topic, rounds, stages, settings }) {
    const id = `tmpl-${randomUUID().slice(0, 8)}`;
    const data = {
      id, name: name || "Untitled", topic: topic || "", rounds: rounds || 4,
      stages: stages || null, settings: settings || {},
      createdAt: new Date().toISOString()
    };
    this.db.prepare("INSERT INTO templates (id, name, data, created_at) VALUES (?, ?, ?, ?)")
      .run(id, data.name, JSON.stringify(data), data.createdAt);
    return data;
  }

  async deleteTemplate(templateId) {
    this.db.prepare("DELETE FROM templates WHERE id = ?").run(templateId);
  }

  // ── Snapshots ──

  async saveSnapshot(agentId, snapshot) {
    this.db.prepare(`
      INSERT OR REPLACE INTO snapshots (id, agent_id, label, data, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(snapshot.id, agentId, snapshot.label || null, JSON.stringify(snapshot), snapshot.createdAt);
  }

  async listSnapshotsMeta(agentId) {
    return this.db.prepare(
      "SELECT id, label, created_at as createdAt FROM snapshots WHERE agent_id = ? ORDER BY created_at DESC"
    ).all(agentId);
  }

  async getSnapshot(agentId, snapshotId) {
    const row = this.db.prepare("SELECT data FROM snapshots WHERE id = ? AND agent_id = ?").get(snapshotId, agentId);
    if (!row) throw new AppError(`Snapshot not found: ${snapshotId}`, 404);
    return JSON.parse(row.data);
  }

  async deleteSnapshot(agentId, snapshotId) {
    this.db.prepare("DELETE FROM snapshots WHERE id = ? AND agent_id = ?").run(snapshotId, agentId);
  }

  // ── Migration & Recovery ──

  async migrateMetaFiles() {
    // No-op for SQLite — data is already indexed
  }

  async recoverStaleRuns() {
    const rows = this.db.prepare("SELECT id, data FROM runs WHERE status = 'running'").all();
    const recovered = [];
    for (const row of rows) {
      const run = JSON.parse(row.data);
      run.metadata.status = "interrupted";
      run.metadata.interruptedAt = new Date().toISOString();
      this.db.prepare("UPDATE runs SET status = 'interrupted', data = ? WHERE id = ?")
        .run(JSON.stringify(run), row.id);
      recovered.push(row.id);
    }
    return recovered;
  }

  async countAgentSessions(agentId) {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM agent_sessions WHERE agent_id = ?").get(agentId);
    return row.cnt;
  }

  // ── Users ──

  async createUser({ name }) {
    const id = `user-${randomUUID().slice(0, 8)}`;
    const apiKey = `noia-${randomUUID()}`;
    const user = { id, name: name || "User", apiKey, createdAt: new Date().toISOString() };
    this.db.prepare("INSERT INTO users (id, name, api_key, created_at) VALUES (?, ?, ?, ?)")
      .run(user.id, user.name, user.apiKey, user.createdAt);
    return user;
  }

  async listUsers() {
    return this.db.prepare("SELECT id, name, api_key as apiKey, created_at as createdAt FROM users").all();
  }

  async loadUser(userId) {
    const row = this.db.prepare("SELECT id, name, api_key as apiKey, created_at as createdAt FROM users WHERE id = ?").get(userId);
    if (!row) throw new AppError(`User not found: ${userId}`, 404);
    return row;
  }

  async deleteUser(userId) {
    this.db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }

  // ── Documents ──

  async saveDocument(docId, data) {
    this.db.prepare("INSERT OR REPLACE INTO documents (id, data, created_at) VALUES (?, ?, ?)")
      .run(docId, JSON.stringify(data), data.createdAt || new Date().toISOString());
  }

  async loadDocument(docId) {
    const row = this.db.prepare("SELECT data FROM documents WHERE id = ?").get(docId);
    if (!row) throw new AppError(`Document not found: ${docId}`, 404);
    return JSON.parse(row.data);
  }

  async listDocuments() {
    const rows = this.db.prepare("SELECT data FROM documents ORDER BY created_at DESC").all();
    return rows.map((r) => JSON.parse(r.data));
  }

  async deleteDocument(docId) {
    this.db.prepare("DELETE FROM documents WHERE id = ?").run(docId);
  }

  close() {
    this.db.close();
  }
}

module.exports = { SqliteStore };
