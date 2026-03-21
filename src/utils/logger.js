const fs = require("fs");
const path = require("path");

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_LOG_FILES = 5;

let logLevel = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;
let logDir = process.env.LOG_DIR || "";
let logStream = null;
let currentLogPath = "";
let currentLogSize = 0;

function setLogLevel(level) {
  logLevel = LOG_LEVELS[level] ?? LOG_LEVELS.info;
}

function ensureLogDir() {
  if (!logDir || logStream) return;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    currentLogPath = path.join(logDir, "app.log");
    try {
      const stat = fs.statSync(currentLogPath);
      currentLogSize = stat.size;
    } catch { currentLogSize = 0; }
    logStream = fs.createWriteStream(currentLogPath, { flags: "a" });
  } catch {
    logDir = "";
  }
}

function rotate() {
  if (!logStream || currentLogSize < MAX_LOG_SIZE) return;
  logStream.end();
  // Shift existing rotated files
  for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
    const src = path.join(logDir, `app.${i}.log`);
    const dst = path.join(logDir, `app.${i + 1}.log`);
    try { fs.renameSync(src, dst); } catch { /* ok */ }
  }
  try { fs.renameSync(currentLogPath, path.join(logDir, "app.1.log")); } catch { /* ok */ }
  logStream = fs.createWriteStream(currentLogPath, { flags: "a" });
  currentLogSize = 0;
}

function emit(level, message, meta) {
  if (LOG_LEVELS[level] < logLevel) return;

  const entry = {
    time: new Date().toISOString(),
    level,
    msg: message
  };
  if (meta !== undefined && meta !== null) entry.data = meta;

  const json = JSON.stringify(entry);

  // Console output — human-friendly
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  const line = `[${entry.time}] [${level.toUpperCase()}] ${message}${suffix}`;

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  // File output — structured JSON lines
  if (logDir) {
    ensureLogDir();
    if (logStream) {
      const bytes = Buffer.byteLength(json) + 1;
      logStream.write(json + "\n");
      currentLogSize += bytes;
      rotate();
    }
  }
}

const logger = {
  debug(message, meta) { emit("debug", message, meta); },
  info(message, meta) { emit("info", message, meta); },
  warn(message, meta) { emit("warn", message, meta); },
  error(message, meta) { emit("error", message, meta); },
  setLogLevel
};

module.exports = { logger };
