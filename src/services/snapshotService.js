const fs = require("fs/promises");
const path = require("path");
const { AppError } = require("../utils/errors");

class SnapshotService {
  constructor(store) {
    this.store = store;
    // Detect if store has native snapshot support (SqliteStore)
    this._native = typeof store.saveSnapshot === "function";
  }

  snapshotsDir(agentId) {
    return path.join(this.store.agentsDir, agentId, "snapshots");
  }

  async createSnapshot(agentId, { label } = {}) {
    const agent = await this.store.loadAgent(agentId);
    const now = new Date();
    const id = `snap-${now.toISOString().replace(/[:.]/g, "-")}`;

    const snapshot = {
      id,
      agentId,
      label: label || null,
      createdAt: now.toISOString(),
      memory: agent.memory,
      identity: agent.identity,
      system: agent.system,
      config: agent.config || {}
    };

    if (this._native) {
      await this.store.saveSnapshot(agentId, snapshot);
    } else {
      const dir = this.snapshotsDir(agentId);
      await fs.mkdir(dir, { recursive: true });
      await this.store.writeJson(path.join(dir, `${id}.json`), snapshot);
    }
    await this.pruneOldSnapshots(agentId);

    return snapshot;
  }

  async listSnapshots(agentId) {
    if (this._native) {
      return await this.store.listSnapshotsMeta(agentId);
    }

    const dir = this.snapshotsDir(agentId);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }

    const snapshots = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const data = await this.store.readJson(path.join(dir, entry.name), null);
        if (data && data.id) {
          snapshots.push({ id: data.id, label: data.label, createdAt: data.createdAt });
        }
      } catch { /* skip malformed */ }
    }

    snapshots.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return snapshots;
  }

  async getSnapshot(agentId, snapshotId) {
    if (this._native) {
      return await this.store.getSnapshot(agentId, snapshotId);
    }

    const filePath = path.join(this.snapshotsDir(agentId), `${snapshotId}.json`);
    const data = await this.store.readJson(filePath, null);
    if (!data) throw new AppError(`Snapshot not found: ${snapshotId}`, 404);
    return data;
  }

  async restoreSnapshot(agentId, snapshotId) {
    const snapshot = await this.getSnapshot(agentId, snapshotId);

    // Safety snapshot before restoring
    await this.createSnapshot(agentId, { label: "pre-restore" });

    if (this._native) {
      // SqliteStore: update agent row directly
      await this.store.createAgent(agentId, {
        identity: snapshot.identity || "",
        system: snapshot.system || "",
        memory: snapshot.memory || ""
      });
      if (snapshot.config) {
        await this.store.saveAgentConfig(agentId, snapshot.config);
      }
    } else {
      // FileStore: overwrite agent files
      await this.store.writeText(this.store.agentPath(agentId, "memory.md"), snapshot.memory || "");
      await this.store.writeText(this.store.agentPath(agentId, "identity.md"), snapshot.identity || "");
      await this.store.writeText(this.store.agentPath(agentId, "system.md"), snapshot.system || "");
      await this.store.writeJson(this.store.agentPath(agentId, "config.json"), snapshot.config || {});
    }

    return snapshot;
  }

  async pruneOldSnapshots(agentId, keepCount = 50) {
    const all = await this.listSnapshots(agentId);
    if (all.length <= keepCount) return 0;

    const toDelete = all.slice(keepCount);

    if (this._native) {
      for (const snap of toDelete) {
        await this.store.deleteSnapshot(agentId, snap.id);
      }
    } else {
      const dir = this.snapshotsDir(agentId);
      for (const snap of toDelete) {
        await fs.unlink(path.join(dir, `${snap.id}.json`)).catch(() => {});
      }
    }
    return toDelete.length;
  }
}

module.exports = { SnapshotService };
