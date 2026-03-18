const path = require("path");
const express = require("express");
const { config } = require("./src/config");
const apiRouter = require("./src/routes/api");
const { ensureBootstrap } = require("./src/storage/bootstrap");
const { logger } = require("./src/utils/logger");
const { toAppError } = require("./src/utils/errors");

async function start() {
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

  app.listen(config.port, () => {
    logger.info(`Scientific Agent Lab running on http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  logger.error("Server startup failed", { message: error.message });
  process.exit(1);
});
