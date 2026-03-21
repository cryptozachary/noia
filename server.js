const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const { config } = require("./src/config");
const apiRouter = require("./src/routes/api");
const { ensureBootstrap } = require("./src/storage/bootstrap");
const { logger } = require("./src/utils/logger");
const { toAppError } = require("./src/utils/errors");
const { shutdownAll } = require("./src/orchestrator/runManager");

async function start() {
  const provider = (config.llmProvider || "openai").toLowerCase();
  if (provider === "anthropic" && !config.anthropic.apiKey) {
    logger.error("ANTHROPIC_API_KEY is not set. Add it to your .env file and restart.");
    process.exit(1);
  } else if (provider !== "anthropic" && !config.openai.apiKey) {
    logger.error("OPENAI_API_KEY is not set. Add it to your .env file and restart.");
    process.exit(1);
  }

  await ensureBootstrap();

  const recovered = await apiRouter.initializeStore();
  if (recovered.length > 0) {
    logger.info(`Recovered ${recovered.length} interrupted run(s)`, { runIds: recovered });
  }

  const app = express();

  // ── Security headers ──
  app.use(helmet({
    contentSecurityPolicy: config.nodeEnv === "production" ? undefined : false,
    crossOriginEmbedderPolicy: false
  }));

  // ── CORS ──
  const corsOptions = {};
  if (config.corsOrigin) {
    corsOptions.origin = config.corsOrigin.split(",").map((s) => s.trim());
  }
  corsOptions.credentials = true;
  app.use(cors(corsOptions));

  // ── Rate limiting ──
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
    skip: (req) => req.path === "/api/health"
  });
  app.use("/api", apiLimiter);

  // Stricter limit for discussion creation (expensive LLM calls)
  const discussionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many discussions created. Please wait." }
  });
  app.use("/api/discussions", discussionLimiter);

  // ── Request logging ──
  const morganStream = { write: (msg) => logger.info(msg.trimEnd()) };
  app.use(morgan(
    config.nodeEnv === "production"
      ? ":remote-addr :method :url :status :res[content-length] - :response-time ms"
      : "dev",
    { stream: morganStream, skip: (_req, res) => res.statusCode < 400 && config.nodeEnv === "production" }
  ));

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/api", apiRouter);

  const distDir = path.join(__dirname, "dist");
  const publicDir = path.join(__dirname, "public");
  const staticDir = fs.existsSync(distDir) ? distDir : publicDir;

  app.use(express.static(staticDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });

  app.use((error, _req, res, _next) => {
    const appError = toAppError(error);
    logger.error(appError.message, appError.details || null);

    res.status(appError.statusCode || 500).json({
      error: appError.message,
      details: config.nodeEnv === "production" ? undefined : appError.details || null
    });
  });

  const server = app.listen(config.port, () => {
    logger.info(`Scientific Agent Lab running on http://localhost:${config.port} [${config.nodeEnv}]`);
  });

  function gracefulShutdown(signal) {
    logger.info(`${signal} received — shutting down gracefully`);
    shutdownAll();
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

start().catch((error) => {
  logger.error("Server startup failed", { message: error.message });
  process.exit(1);
});
