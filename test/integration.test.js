const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

let server;
let baseUrl;
let tmpDir;

function request(method, urlPath, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { "Content-Type": "application/json", ...extraHeaders }
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe("Integration tests", () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "noia-integ-"));
    const dirs = ["runs", "agents", "exports", "topics", "templates", "users", "documents"];
    for (const d of dirs) await fs.mkdir(path.join(tmpDir, d), { recursive: true });

    // Seed minimal agents
    for (const agentId of ["research-synthesizer", "skeptical-reviewer", "innovation-strategist", "coordinator"]) {
      const agentDir = path.join(tmpDir, "agents", agentId);
      await fs.mkdir(path.join(agentDir, "sessions"), { recursive: true });
      await fs.mkdir(path.join(agentDir, "snapshots"), { recursive: true });
      await fs.writeFile(path.join(agentDir, "identity.md"), `# ${agentId}\n`);
      await fs.writeFile(path.join(agentDir, "system.md"), `You are the ${agentId} agent.\n`);
      await fs.writeFile(path.join(agentDir, "memory.md"), "# Memory\n");
    }

    // Override config
    const { config } = require("../src/config");
    config.dataDir = tmpDir;
    config.storageBackend = "file";
    config.requireAuth = false;
    config.nodeEnv = "test";

    const express = require("express");
    const helmet = require("helmet");
    const cors = require("cors");
    const rateLimit = require("express-rate-limit");
    const { requestIdMiddleware } = require("../src/middleware/requestId");

    // Clear cached modules so createStore picks up new config
    delete require.cache[require.resolve("../src/routes/api")];
    delete require.cache[require.resolve("../src/storage/index")];
    const apiRouter = require("../src/routes/api");
    await apiRouter.initializeStore();

    const app = express();
    app.use(requestIdMiddleware());
    app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
    app.use(cors());
    app.use(rateLimit({ windowMs: 60000, max: 1000, skip: (req) => req.path.endsWith("/stream") }));
    app.use(express.json({ limit: "2mb" }));
    app.use("/api", apiRouter);
    app.use((error, req, res, _next) => {
      const status = error.statusCode || 500;
      res.status(status).json({ error: error.message, requestId: req.id });
    });

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Health ──

  it("GET /api/health returns status ok with metrics", async () => {
    const res = await request("GET", "/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.ok(res.body.time);
    assert.equal(typeof res.body.uptime, "number");
    assert.equal(typeof res.body.activeRuns, "number");
    assert.ok(res.body.memory);
    assert.ok(res.body.node);
  });

  // ── Request ID ──

  it("generates request ID when none provided", async () => {
    const res = await request("GET", "/api/health");
    assert.ok(res.headers["x-request-id"]);
    assert.ok(res.headers["x-request-id"].length > 0);
  });

  it("echoes provided X-Request-Id header", async () => {
    const res = await request("GET", "/api/health", null, { "X-Request-Id": "trace-abc-123" });
    assert.equal(res.headers["x-request-id"], "trace-abc-123");
  });

  // ── Security headers ──

  it("responses include helmet X-Content-Type-Options", async () => {
    const res = await request("GET", "/api/health");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
  });

  it("CORS preflight returns allow headers", async () => {
    const url = new URL("/api/health", baseUrl);
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        method: "OPTIONS",
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: { Origin: "http://example.com", "Access-Control-Request-Method": "GET" }
      }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers }));
      });
      req.on("error", reject);
      req.end();
    });
    assert.ok(res.headers["access-control-allow-origin"]);
  });

  // ── Runs ──

  it("GET /api/runs returns empty list initially", async () => {
    const res = await request("GET", "/api/runs");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.runs));
  });

  it("GET /api/runs respects pagination params", async () => {
    const res = await request("GET", "/api/runs?page=1&limit=10");
    assert.equal(res.status, 200);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.limit, 10);
  });

  it("GET /api/runs/:runId returns 404 for missing run", async () => {
    const res = await request("GET", "/api/runs/nonexistent-run");
    assert.equal(res.status, 404);
  });

  it("DELETE /api/runs/:runId succeeds silently for missing run", async () => {
    const res = await request("DELETE", "/api/runs/nonexistent-run");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  // ── Agents ──

  it("GET /api/agents returns agent list with all seeded agents", async () => {
    const res = await request("GET", "/api/agents");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.agents));
    assert.ok(res.body.agents.length >= 4);
  });

  it("GET /api/agents/:agentId/memory returns memory text", async () => {
    const res = await request("GET", "/api/agents/research-synthesizer/memory");
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.memory, "string");
    assert.equal(res.body.agentId, "research-synthesizer");
  });

  it("PUT /api/agents/:agentId/memory updates memory and verifies", async () => {
    const put = await request("PUT", "/api/agents/research-synthesizer/memory", { memory: "# Updated\nNew content here" });
    assert.equal(put.status, 200);
    assert.equal(put.body.ok, true);

    const get = await request("GET", "/api/agents/research-synthesizer/memory");
    assert.ok(get.body.memory.includes("New content here"));
  });

  it("validates path params — rejects path traversal", async () => {
    const res = await request("GET", "/api/agents/..%2F..%2Fetc/memory");
    assert.equal(res.status, 400);
  });

  // ── Templates ──

  it("POST /api/templates creates, lists, and deletes", async () => {
    const create = await request("POST", "/api/templates", {
      name: "Integration Test Template",
      topic: "Test topic for integration",
      rounds: 3
    });
    assert.equal(create.status, 201);
    assert.ok(create.body.template.id.startsWith("tmpl-"));

    const list = await request("GET", "/api/templates");
    assert.equal(list.status, 200);
    assert.ok(list.body.templates.some((t) => t.name === "Integration Test Template"));

    const del = await request("DELETE", `/api/templates/${create.body.template.id}`);
    assert.equal(del.status, 200);
    assert.equal(del.body.ok, true);
  });

  it("POST /api/templates rejects empty name", async () => {
    const res = await request("POST", "/api/templates", { name: "", topic: "x" });
    assert.equal(res.status, 400);
  });

  // ── Cost ──

  it("GET /api/cost/estimate returns estimate object", async () => {
    const res = await request("GET", "/api/cost/estimate?model=gpt-4.1-mini&rounds=4&agentCount=3");
    assert.equal(res.status, 200);
    assert.ok(res.body.estimate !== undefined);
  });

  // ── Documents ──

  it("GET /api/documents returns list", async () => {
    const res = await request("GET", "/api/documents");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.documents));
  });

  it("GET /api/documents/:docId returns 404 for missing", async () => {
    const res = await request("GET", "/api/documents/nonexistent");
    assert.equal(res.status, 404);
  });

  // ── Discussion validation ──

  it("POST /api/discussions rejects empty topic", async () => {
    const res = await request("POST", "/api/discussions", { topic: "" });
    assert.equal(res.status, 400);
  });

  it("POST /api/discussions rejects rounds out of range", async () => {
    const res = await request("POST", "/api/discussions", { topic: "Test topic", rounds: 20 });
    assert.equal(res.status, 400);
  });

  // ── Error responses ──

  it("404 error includes requestId in body", async () => {
    const res = await request("GET", "/api/runs/does-not-exist");
    assert.equal(res.status, 404);
    assert.ok(res.body.requestId);
  });

  it("400 error includes requestId in body", async () => {
    const res = await request("POST", "/api/discussions", { topic: "" });
    assert.equal(res.status, 400);
    assert.ok(res.body.requestId);
  });

  // ── Active discussions ──

  it("GET /api/discussions/active returns empty array when idle", async () => {
    const res = await request("GET", "/api/discussions/active");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.activeRunIds));
    assert.equal(res.body.activeRunIds.length, 0);
  });

  // ── Annotations ──

  it("annotation CRUD via API", async () => {
    // First create a run file directly so we can annotate it
    const runId = "test-run-for-annotations";
    const runData = {
      id: runId, topic: "Test", title: "Test", createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), rounds: 2, roundMessages: [],
      metadata: { status: "completed" }
    };
    const meta = { id: runId, title: "Test", topic: "Test", createdAt: runData.createdAt, updatedAt: runData.updatedAt, status: "completed" };
    await fs.writeFile(path.join(tmpDir, "runs", `${runId}.json`), JSON.stringify(runData));
    await fs.writeFile(path.join(tmpDir, "runs", `${runId}.meta.json`), JSON.stringify(meta));

    // Get annotations (empty)
    const get1 = await request("GET", `/api/runs/${runId}/annotations`);
    assert.equal(get1.status, 200);
    assert.equal(get1.body.annotations.length, 0);

    // Add annotation
    const add = await request("POST", `/api/runs/${runId}/annotations`, { text: "Great insight", round: 1, agentId: "research-synthesizer" });
    assert.equal(add.status, 201);
    assert.ok(add.body.annotation.id.startsWith("ann-"));

    // Verify
    const get2 = await request("GET", `/api/runs/${runId}/annotations`);
    assert.equal(get2.body.annotations.length, 1);

    // Delete
    const del = await request("DELETE", `/api/runs/${runId}/annotations/${add.body.annotation.id}`);
    assert.equal(del.status, 200);

    const get3 = await request("GET", `/api/runs/${runId}/annotations`);
    assert.equal(get3.body.annotations.length, 0);
  });

  // ── Snapshots ──

  it("snapshot create and list via API", async () => {
    const create = await request("POST", "/api/agents/research-synthesizer/snapshot", { label: "integration-test" });
    assert.equal(create.status, 201);
    assert.ok(create.body.snapshot.id);
    assert.equal(create.body.snapshot.label, "integration-test");

    const list = await request("GET", "/api/agents/research-synthesizer/snapshots");
    assert.equal(list.status, 200);
    assert.ok(list.body.snapshots.length >= 1);
  });

  // ── Usage ──

  it("GET /api/usage returns aggregated usage data", async () => {
    const res = await request("GET", "/api/usage");
    assert.equal(res.status, 200);
    assert.ok(res.body.totals);
    assert.equal(typeof res.body.totals.input_tokens, "number");
    assert.equal(typeof res.body.totals.output_tokens, "number");
    assert.equal(typeof res.body.totals.totalCost, "number");
    assert.equal(typeof res.body.totals.runCount, "number");
    assert.ok(res.body.byModel);
    assert.ok(res.body.byDay);
    assert.ok(Array.isArray(res.body.recentRuns));
  });

  // ── Users (no auth required) ──

  it("GET /api/users/me returns null user when no auth", async () => {
    const res = await request("GET", "/api/users/me");
    assert.equal(res.status, 200);
    assert.equal(res.body.user, null);
  });
});
