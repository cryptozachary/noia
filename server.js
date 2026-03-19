const path = require("path");
const express = require("express");
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

  const app = express();

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/api", apiRouter);
  app.use(express.static(path.join(__dirname, "public")));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  app.use((error, _req, res, _next) => {
    const appError = toAppError(error);
    logger.error(appError.message, appError.details || null);

    res.status(appError.statusCode || 500).json({
      error: appError.message,
      details: appError.details || null
    });
  });

  const server = app.listen(config.port, () => {
    logger.info(`Scientific Agent Lab running on http://localhost:${config.port}`);
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
