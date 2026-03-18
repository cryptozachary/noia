function stamp(level, message, meta) {
  const ts = new Date().toISOString();
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  return `[${ts}] [${level}] ${message}${suffix}`;
}

const logger = {
  info(message, meta) {
    console.log(stamp("INFO", message, meta));
  },
  warn(message, meta) {
    console.warn(stamp("WARN", message, meta));
  },
  error(message, meta) {
    console.error(stamp("ERROR", message, meta));
  }
};

module.exports = { logger };
