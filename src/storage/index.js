const path = require("path");
const { config } = require("../config");

function createStore() {
  if (config.storageBackend === "sqlite") {
    const { SqliteStore } = require("./sqliteStore");
    const dbPath = config.sqlitePath || path.join(config.dataDir, "noia.db");
    return new SqliteStore(dbPath);
  }

  const { FileStore } = require("./fileStore");
  return new FileStore(config.dataDir);
}

module.exports = { createStore };
