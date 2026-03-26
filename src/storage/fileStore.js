const fs = require("fs/promises");
const path = require("path");
const { randomUUID, createHash } = require("crypto");
const { config } = require("../config");
const { AppError } = require("../utils/errors");

class FileStore {
  constructor(baseDir = config.dataDir) {
    this.baseDir = baseDir;
    this.runsDir = path.join(this.baseDir, "runs");
    this.agentsDir = path.join(this.baseDir, "agents");
    this.exportsDir = path.join(this.baseDir, "exports");
    this.topicsDir = path.join(this.baseDir, "topics");
    this.templatesDir = path.join(this.baseDir, "templates");
    this.usersDir = path.join(this.baseDir, "users");
    this.documentsDir = path.join(this.baseDir, "documents");
    this._runIndexCache = null;
    this._runIndexDirty = true;
    this._locks = new Map();
  }

  /** Serialize writes to the same file path to prevent race conditions. */
  async _withLock(key, fn) {
    const prev = this._locks.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    this._locks.set(key, next);
    try {
      return await next;
    } finally {
      if (this._locks.get(key) === next) this._locks.delete(key);
    }
  }

  async readText(filePath, fallback = "") {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return fallback;
      }
      throw new AppError(`Failed reading file: ${filePath}`, 500, { code: error.code });
    }
  }

  async writeText(filePath, content) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }

  async readJson(filePath, fallback = null) {
    const raw = await this.readText(filePath, "");
    if (!raw.trim()) {
      return fallback;
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new AppError(`Invalid JSON in file: ${filePath}`, 500, { message: error.message });
    }
  }

  async writeJson(filePath, data) {
    await this.writeText(filePath, JSON.stringify(data, null, 2));
  }

  runPath(runId) {
    return path.join(this.runsDir, `${runId}.json`);
  }

  runMetaPath(runId) {
    return path.join(this.runsDir, `${runId}.meta.json`);
  }

  async createRunRecord({ topic, title, rounds, settings, userId }) {
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const record = {
      id: runId,
      title,
      topic,
      createdAt: now,
      updatedAt: now,
      settings,
      rounds,
      roundMessages: [],
      finalReport: "",
      metadata: {
        status: "running"
      }
    };
    if (userId) record.userId = userId;
    return record;
  }

  async saveRun(run) {
    return this._withLock(`run:${run.id}`, async () => {
      run.updatedAt = new Date().toISOString();
      const meta = {
        id: run.id,
        title: run.title,
        topic: run.topic,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        status: run.metadata && run.metadata.status ? run.metadata.status : "unknown"
      };
      if (run.branchedFrom) meta.branchedFrom = run.branchedFrom;
      if (run.userId) meta.userId = run.userId;
      if (run._researchSources && run._researchSources.length > 0) {
        meta.researchSourceCount = run._researchSources.length;
      }
      if (run.metadata && run.metadata.tokenUsage) meta.tokenUsage = run.metadata.tokenUsage;
      if (run.metadata && run.metadata.model) meta.model = run.metadata.model;
      await Promise.all([
        this.writeJson(this.runPath(run.id), run),
        this.writeJson(this.runMetaPath(run.id), meta)
      ]);
      this._runIndexDirty = true;
    });
  }

  async loadRun(runId) {
    const run = await this.readJson(this.runPath(runId), null);
    if (!run) {
      throw new AppError(`Run not found: ${runId}`, 404);
    }
    return run;
  }

  async listRuns({ page = 1, limit = 50, userId } = {}) {
    if (!this._runIndexDirty && this._runIndexCache) {
      const filtered = userId ? this._runIndexCache.filter((r) => r.userId === userId) : this._runIndexCache;
      const start = (page - 1) * limit;
      const paged = filtered.slice(start, start + limit);
      return { runs: paged, total: filtered.length, page, limit };
    }

    const entries = await fs.readdir(this.runsDir, { withFileTypes: true });
    const runs = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".meta.json")) continue;
      const fullPath = path.join(this.runsDir, entry.name);
      try {
        const meta = await this.readJson(fullPath, null);
        if (meta && meta.id) runs.push(meta);
      } catch (_error) {
        // Skip malformed meta files
      }
    }

    runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    this._runIndexCache = runs;
    this._runIndexDirty = false;

    const filtered = userId ? runs.filter((r) => r.userId === userId) : runs;
    const start = (page - 1) * limit;
    const paged = filtered.slice(start, start + limit);
    return { runs: paged, total: filtered.length, page, limit };
  }

  agentPath(agentId, fileName) {
    return path.join(this.agentsDir, agentId, fileName);
  }

  async loadAgent(agentId) {
    const identity = await this.readText(this.agentPath(agentId, "identity.md"));
    const system = await this.readText(this.agentPath(agentId, "system.md"));
    const memory = await this.readText(this.agentPath(agentId, "memory.md"));
    const agentConfig = await this.readJson(this.agentPath(agentId, "config.json"), {});

    if (!identity || !system) {
      throw new AppError(`Agent configuration missing for ${agentId}`, 500);
    }

    return { agentId, identity, system, memory, config: agentConfig };
  }

  async loadAgentConfig(agentId) {
    return this.readJson(this.agentPath(agentId, "config.json"), {});
  }

  async saveAgentConfig(agentId, agentConfig) {
    await this.writeJson(this.agentPath(agentId, "config.json"), agentConfig);
  }

  async listAgents() {
    const entries = await fs.readdir(this.agentsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  }

  async readAgentMemory(agentId) {
    return this.readText(this.agentPath(agentId, "memory.md"));
  }

  async writeAgentMemory(agentId, content) {
    return this._withLock(`memory:${agentId}`, async () => {
      await this.writeText(this.agentPath(agentId, "memory.md"), content);
    });
  }

  async appendAgentSessionEntry(agentId, runId, entry) {
    return this._withLock(`session:${agentId}:${runId}`, async () => {
      const sessionPath = path.join(this.agentsDir, agentId, "sessions", `${runId}.json`);
      const existing = (await this.readJson(sessionPath, {
        runId,
        agentId,
        createdAt: new Date().toISOString(),
        entries: []
      })) || { runId, agentId, createdAt: new Date().toISOString(), entries: [] };

      existing.entries.push(entry);
      existing.updatedAt = new Date().toISOString();

      await this.writeJson(sessionPath, existing);
    });
  }

  async createAgent(agentId, { identity, system, memory }) {
    const agentDir = path.join(this.agentsDir, agentId);
    const sessionsDir = path.join(agentDir, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    await this.writeText(path.join(agentDir, "identity.md"), identity || `# ${agentId}\n`);
    await this.writeText(path.join(agentDir, "system.md"), system || "You are a custom agent.\n");
    await this.writeText(path.join(agentDir, "memory.md"), memory || "# Memory\n");
  }

  annotationsPath(runId) {
    return path.join(this.runsDir, `${runId}.annotations.json`);
  }

  async loadAnnotations(runId) {
    return this.readJson(this.annotationsPath(runId), { runId, annotations: [] });
  }

  async saveAnnotations(runId, data) {
    await this.writeJson(this.annotationsPath(runId), data);
  }

  async deleteAnnotationsForRun(runId) {
    await fs.unlink(this.annotationsPath(runId)).catch(() => {});
  }

  async deleteRun(runId) {
    await fs.unlink(this.runPath(runId)).catch(() => {});
    await fs.unlink(this.runMetaPath(runId)).catch(() => {});
    await fs.unlink(path.join(this.exportsDir, `${runId}.md`)).catch(() => {});
    await this.deleteAnnotationsForRun(runId);

    const agentDirs = await this.listAgents();
    for (const agentId of agentDirs) {
      const sessionFile = path.join(this.agentsDir, agentId, "sessions", `${runId}.json`);
      await fs.unlink(sessionFile).catch(() => {});
    }

    this._runIndexDirty = true;
  }

  async loadMemoryEmbeddings(agentId) {
    return this.readJson(this.agentPath(agentId, "memory_embeddings.json"), null);
  }

  async saveMemoryEmbeddings(agentId, data) {
    await this.writeJson(this.agentPath(agentId, "memory_embeddings.json"), data);
  }

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

  async saveExport(runId, markdownText) {
    const filePath = path.join(this.exportsDir, `${runId}.md`);
    await this.writeText(filePath, markdownText);
    return filePath;
  }

  async listTemplates() {
    try {
      const entries = await fs.readdir(this.templatesDir, { withFileTypes: true });
      const templates = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        try {
          const tmpl = await this.readJson(path.join(this.templatesDir, entry.name), null);
          if (tmpl && tmpl.id) templates.push(tmpl);
        } catch { /* skip malformed */ }
      }
      templates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return templates;
    } catch {
      return [];
    }
  }

  async loadTemplate(templateId) {
    const tmpl = await this.readJson(path.join(this.templatesDir, `${templateId}.json`), null);
    if (!tmpl) throw new AppError(`Template not found: ${templateId}`, 404);
    return tmpl;
  }

  async saveTemplate({ name, topic, rounds, stages, settings }) {
    const id = `tmpl-${randomUUID().slice(0, 8)}`;
    const data = {
      id,
      name: name || "Untitled",
      topic: topic || "",
      rounds: rounds || 4,
      stages: stages || null,
      settings: settings || {},
      createdAt: new Date().toISOString()
    };
    await this.writeJson(path.join(this.templatesDir, `${id}.json`), data);
    return data;
  }

  async deleteTemplate(templateId) {
    await fs.unlink(path.join(this.templatesDir, `${templateId}.json`)).catch(() => {});
  }

  async migrateMetaFiles() {
    const entries = await fs.readdir(this.runsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".meta.json") || entry.name.endsWith(".annotations.json")) continue;
      const runId = entry.name.replace(".json", "");
      const metaPath = this.runMetaPath(runId);
      try {
        await fs.access(metaPath);
      } catch {
        try {
          const run = await this.readJson(path.join(this.runsDir, entry.name), null);
          if (run && run.id) {
            const meta = {
              id: run.id,
              title: run.title,
              topic: run.topic,
              createdAt: run.createdAt,
              updatedAt: run.updatedAt,
              status: run.metadata && run.metadata.status ? run.metadata.status : "unknown"
            };
            if (run.branchedFrom) meta.branchedFrom = run.branchedFrom;
            await this.writeJson(metaPath, meta);
          }
        } catch { /* skip */ }
      }
    }
  }

  async recoverStaleRuns() {
    const entries = await fs.readdir(this.runsDir, { withFileTypes: true });
    const recovered = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".meta.json")) continue;
      try {
        const metaPath = path.join(this.runsDir, entry.name);
        const meta = await this.readJson(metaPath, null);
        if (meta && meta.status === "running") {
          meta.status = "interrupted";
          await this.writeJson(metaPath, meta);
          const run = await this.readJson(this.runPath(meta.id), null);
          if (run && run.metadata) {
            run.metadata.status = "interrupted";
            run.metadata.interruptedAt = new Date().toISOString();
            await this.writeJson(this.runPath(meta.id), run);
          }
          recovered.push(meta.id);
        }
      } catch { /* skip */ }
    }
    this._runIndexDirty = true;
    return recovered;
  }

  async countAgentSessions(agentId) {
    const sessionsDir = path.join(this.agentsDir, agentId, "sessions");
    try {
      const entries = await fs.readdir(sessionsDir);
      return entries.filter((e) => e.endsWith(".json")).length;
    } catch {
      return 0;
    }
  }

  async createUser({ name }) {
    const id = `user-${randomUUID().slice(0, 8)}`;
    const rawKey = `noia-${randomUUID()}`;
    const apiKeyHash = createHash("sha256").update(rawKey).digest("hex");
    const user = { id, name: name || "User", apiKeyHash, createdAt: new Date().toISOString() };
    await fs.mkdir(this.usersDir, { recursive: true });
    await this.writeJson(path.join(this.usersDir, `${id}.json`), user);
    // Return raw key only once — it is not stored
    return { ...user, apiKey: rawKey };
  }

  async listUsers() {
    try {
      const entries = await fs.readdir(this.usersDir, { withFileTypes: true });
      const users = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        try {
          const user = await this.readJson(path.join(this.usersDir, entry.name), null);
          if (user && user.id) users.push(user);
        } catch { /* skip */ }
      }
      return users;
    } catch {
      return [];
    }
  }

  async loadUser(userId) {
    const user = await this.readJson(path.join(this.usersDir, `${userId}.json`), null);
    if (!user) throw new AppError(`User not found: ${userId}`, 404);
    return user;
  }

  async deleteUser(userId) {
    await fs.unlink(path.join(this.usersDir, `${userId}.json`)).catch(() => {});
  }

  // ── Documents ──

  async saveDocument(docId, data) {
    await fs.mkdir(this.documentsDir, { recursive: true });
    await this.writeJson(path.join(this.documentsDir, `${docId}.json`), data);
  }

  async loadDocument(docId) {
    const doc = await this.readJson(path.join(this.documentsDir, `${docId}.json`), null);
    if (!doc) throw new AppError(`Document not found: ${docId}`, 404);
    return doc;
  }

  async listDocuments() {
    try {
      const entries = await fs.readdir(this.documentsDir, { withFileTypes: true });
      const docs = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        try {
          const doc = await this.readJson(path.join(this.documentsDir, entry.name), null);
          if (doc && doc.id) docs.push(doc);
        } catch { /* skip */ }
      }
      docs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return docs;
    } catch {
      return [];
    }
  }

  async deleteDocument(docId) {
    await fs.unlink(path.join(this.documentsDir, `${docId}.json`)).catch(() => {});
  }
}

module.exports = { FileStore };
