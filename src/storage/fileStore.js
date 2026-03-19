const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { config } = require("../config");
const { AppError } = require("../utils/errors");

class FileStore {
  constructor(baseDir = config.dataDir) {
    this.baseDir = baseDir;
    this.runsDir = path.join(this.baseDir, "runs");
    this.agentsDir = path.join(this.baseDir, "agents");
    this.exportsDir = path.join(this.baseDir, "exports");
    this.topicsDir = path.join(this.baseDir, "topics");
    this._runIndexCache = null;
    this._runIndexDirty = true;
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

  async createRunRecord({ topic, title, rounds, settings }) {
    const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    return {
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
  }

  async saveRun(run) {
    run.updatedAt = new Date().toISOString();
    await this.writeJson(this.runPath(run.id), run);
    this._runIndexDirty = true;
  }

  async loadRun(runId) {
    const run = await this.readJson(this.runPath(runId), null);
    if (!run) {
      throw new AppError(`Run not found: ${runId}`, 404);
    }
    return run;
  }

  async listRuns() {
    if (!this._runIndexDirty && this._runIndexCache) {
      return this._runIndexCache;
    }

    const entries = await fs.readdir(this.runsDir, { withFileTypes: true });
    const runs = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const fullPath = path.join(this.runsDir, entry.name);
      try {
        const run = await this.readJson(fullPath, null);
        if (run && run.id) {
          runs.push({
            id: run.id,
            title: run.title,
            topic: run.topic,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
            status: run.metadata && run.metadata.status ? run.metadata.status : "unknown"
          });
        }
      } catch (_error) {
        // Skip malformed runs but keep the service available.
      }
    }

    runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    this._runIndexCache = runs;
    this._runIndexDirty = false;
    return runs;
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
    await this.writeText(this.agentPath(agentId, "memory.md"), content);
  }

  async appendAgentSessionEntry(agentId, runId, entry) {
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
  }

  async createAgent(agentId, { identity, system, memory }) {
    const agentDir = path.join(this.agentsDir, agentId);
    const sessionsDir = path.join(agentDir, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    await this.writeText(path.join(agentDir, "identity.md"), identity || `# ${agentId}\n`);
    await this.writeText(path.join(agentDir, "system.md"), system || "You are a custom agent.\n");
    await this.writeText(path.join(agentDir, "memory.md"), memory || "# Memory\n");
  }

  async deleteRun(runId) {
    await fs.unlink(this.runPath(runId)).catch(() => {});
    await fs.unlink(path.join(this.exportsDir, `${runId}.md`)).catch(() => {});

    const agentDirs = await this.listAgents();
    for (const agentId of agentDirs) {
      const sessionFile = path.join(this.agentsDir, agentId, "sessions", `${runId}.json`);
      await fs.unlink(sessionFile).catch(() => {});
    }

    this._runIndexDirty = true;
  }

  async saveExport(runId, markdownText) {
    const filePath = path.join(this.exportsDir, `${runId}.md`);
    await this.writeText(filePath, markdownText);
    return filePath;
  }
}

module.exports = { FileStore };
