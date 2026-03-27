const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

let tmpDir;
let store;

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "noia-auth-test-"));
  const dirs = ["runs", "agents", "exports", "topics", "templates", "users"];
  for (const d of dirs) await fs.mkdir(path.join(tmpDir, d), { recursive: true });

  const { FileStore } = require("../src/storage/fileStore");
  store = new FileStore(tmpDir);
}

async function cleanup() {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
}

describe("FileStore user management", () => {
  beforeEach(async () => {
    await setup();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("createUser returns user with id and apiKey", async () => {
    const user = await store.createUser({ name: "Alice" });
    assert.ok(user.id.startsWith("user-"));
    assert.ok(user.apiKey.startsWith("noia-"));
    assert.equal(user.name, "Alice");
    assert.ok(user.createdAt);
  });

  it("listUsers returns created users", async () => {
    await store.createUser({ name: "Alice" });
    await store.createUser({ name: "Bob" });
    const users = await store.listUsers();
    assert.equal(users.length, 2);
    const names = users.map((u) => u.name).sort();
    assert.deepStrictEqual(names, ["Alice", "Bob"]);
  });

  it("loadUser returns user by ID", async () => {
    const created = await store.createUser({ name: "Charlie" });
    const loaded = await store.loadUser(created.id);
    assert.equal(loaded.id, created.id);
    assert.equal(loaded.name, "Charlie");
    assert.ok(loaded.apiKeyHash, "loaded user should have apiKeyHash");
  });

  it("loadUser throws 404 for missing user", async () => {
    await assert.rejects(
      () => store.loadUser("user-nonexistent"),
      (err) => err.statusCode === 404
    );
  });

  it("deleteUser removes user file", async () => {
    const user = await store.createUser({ name: "DeleteMe" });
    await store.deleteUser(user.id);
    const users = await store.listUsers();
    assert.equal(users.length, 0);
  });

  it("listUsers returns empty array when no users", async () => {
    const users = await store.listUsers();
    assert.deepStrictEqual(users, []);
  });
});

describe("Auth middleware", () => {
  beforeEach(async () => {
    await setup();
  });

  afterEach(async () => {
    await cleanup();
    // Reset config overrides
    const { invalidateUserCache } = require("../src/middleware/auth");
    invalidateUserCache();
  });

  function mockReq(headers = {}, query = {}) {
    return { headers, query, user: null };
  }
  function mockRes() {
    return {};
  }

  it("passes through without auth when REQUIRE_AUTH is false", async () => {
    const config = require("../src/config").config;
    const originalRequireAuth = config.requireAuth;
    config.requireAuth = false;

    try {
      const { authMiddleware } = require("../src/middleware/auth");
      const middleware = authMiddleware(store);
      const req = mockReq();
      let called = false;
      await middleware(req, mockRes(), () => { called = true; });
      assert.ok(called, "next() should be called");
      assert.equal(req.user, null, "user should be null without API key");
    } finally {
      config.requireAuth = originalRequireAuth;
    }
  });

  it("populates req.user when valid API key provided (auth not required)", async () => {
    const config = require("../src/config").config;
    const originalRequireAuth = config.requireAuth;
    config.requireAuth = false;

    try {
      const { authMiddleware, invalidateUserCache } = require("../src/middleware/auth");
      invalidateUserCache();
      const user = await store.createUser({ name: "Test" });
      const middleware = authMiddleware(store);
      const req = mockReq({ "x-api-key": user.apiKey });
      await middleware(req, mockRes(), () => {});
      assert.ok(req.user, "user should be populated");
      assert.equal(req.user.id, user.id);
    } finally {
      config.requireAuth = originalRequireAuth;
    }
  });

  it("returns 401 when auth required and no key provided", async () => {
    const config = require("../src/config").config;
    const originalRequireAuth = config.requireAuth;
    config.requireAuth = true;

    try {
      const { authMiddleware } = require("../src/middleware/auth");
      const middleware = authMiddleware(store);
      const req = mockReq();
      let error = null;
      await middleware(req, mockRes(), (err) => { error = err; });
      assert.ok(error, "should pass error to next");
      assert.equal(error.statusCode, 401);
    } finally {
      config.requireAuth = originalRequireAuth;
    }
  });

  it("returns 403 for invalid API key when auth required", async () => {
    const config = require("../src/config").config;
    const originalRequireAuth = config.requireAuth;
    config.requireAuth = true;

    try {
      const { authMiddleware, invalidateUserCache } = require("../src/middleware/auth");
      invalidateUserCache();
      const middleware = authMiddleware(store);
      const req = mockReq({ "x-api-key": "noia-invalid-key" });
      let error = null;
      await middleware(req, mockRes(), (err) => { error = err; });
      assert.ok(error, "should pass error to next");
      assert.equal(error.statusCode, 403);
    } finally {
      config.requireAuth = originalRequireAuth;
    }
  });

  it("allows admin key bypass when auth required", async () => {
    const config = require("../src/config").config;
    const originalRequireAuth = config.requireAuth;
    const originalAdminKey = config.adminApiKey;
    config.requireAuth = true;
    config.adminApiKey = "test-admin-key";

    try {
      const { authMiddleware } = require("../src/middleware/auth");
      const middleware = authMiddleware(store);
      const req = mockReq({ "x-api-key": "test-admin-key" });
      let called = false;
      await middleware(req, mockRes(), () => { called = true; });
      assert.ok(called, "next() should be called");
      assert.ok(req.user.isAdmin, "user should be admin");
    } finally {
      config.requireAuth = originalRequireAuth;
      config.adminApiKey = originalAdminKey;
    }
  });
});

describe("requireAdmin", () => {
  it("passes when user is admin", () => {
    const { requireAdmin } = require("../src/middleware/auth");
    const req = { user: { id: "admin", isAdmin: true } };
    let called = false;
    requireAdmin(req, {}, () => { called = true; });
    assert.ok(called);
  });

  it("returns 403 when user is not admin", () => {
    const { requireAdmin } = require("../src/middleware/auth");
    const req = { user: { id: "user-1", isAdmin: false } };
    let error = null;
    requireAdmin(req, {}, (err) => { error = err; });
    assert.ok(error);
    assert.equal(error.statusCode, 403);
  });

  it("returns 403 when no user", () => {
    const { requireAdmin } = require("../src/middleware/auth");
    const req = { user: null };
    let error = null;
    requireAdmin(req, {}, (err) => { error = err; });
    assert.ok(error);
    assert.equal(error.statusCode, 403);
  });
});

describe("requireAdminIfAuth", () => {
  afterEach(() => {
    const config = require("../src/config").config;
    config.requireAuth = false;
  });

  it("passes through when requireAuth is false regardless of user", () => {
    const config = require("../src/config").config;
    config.requireAuth = false;
    const { requireAdminIfAuth } = require("../src/middleware/auth");
    const req = { user: null };
    let called = false;
    requireAdminIfAuth(req, {}, () => { called = true; });
    assert.ok(called);
  });

  it("passes when requireAuth is true and user is admin", () => {
    const config = require("../src/config").config;
    config.requireAuth = true;
    const { requireAdminIfAuth } = require("../src/middleware/auth");
    const req = { user: { id: "admin", isAdmin: true } };
    let called = false;
    requireAdminIfAuth(req, {}, () => { called = true; });
    assert.ok(called);
  });

  it("returns 403 when requireAuth is true and user is not admin", () => {
    const config = require("../src/config").config;
    config.requireAuth = true;
    const { requireAdminIfAuth } = require("../src/middleware/auth");
    const req = { user: { id: "user-1", isAdmin: false } };
    let error = null;
    requireAdminIfAuth(req, {}, (err) => { error = err; });
    assert.ok(error);
    assert.equal(error.statusCode, 403);
  });
});

describe("Template ownership (FileStore)", () => {
  beforeEach(async () => {
    await setup();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("saveTemplate stores userId and shared flag", async () => {
    const tmpl = await store.saveTemplate({ name: "T1", topic: "x", userId: "user-1", shared: true });
    const loaded = await store.loadTemplate(tmpl.id);
    assert.equal(loaded.userId, "user-1");
    assert.equal(loaded.shared, true);
  });

  it("listTemplates with userId shows own + shared + ownerless", async () => {
    await store.saveTemplate({ name: "Own", topic: "x", userId: "user-1" });
    await store.saveTemplate({ name: "Shared", topic: "x", userId: "user-2", shared: true });
    await store.saveTemplate({ name: "Other", topic: "x", userId: "user-2" });
    await store.saveTemplate({ name: "Legacy", topic: "x" });

    const visible = await store.listTemplates({ userId: "user-1" });
    const names = visible.map((t) => t.name).sort();
    assert.deepStrictEqual(names, ["Legacy", "Own", "Shared"]);
  });

  it("listTemplates without userId shows all", async () => {
    await store.saveTemplate({ name: "A", topic: "x", userId: "user-1" });
    await store.saveTemplate({ name: "B", topic: "x", userId: "user-2" });
    const all = await store.listTemplates();
    assert.equal(all.length, 2);
  });
});

describe("Document ownership (FileStore)", () => {
  beforeEach(async () => {
    await setup();
    await fs.mkdir(path.join(tmpDir, "documents"), { recursive: true });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("listDocuments with userId shows own + ownerless", async () => {
    await store.saveDocument("doc-1", { id: "doc-1", userId: "user-1", createdAt: new Date().toISOString() });
    await store.saveDocument("doc-2", { id: "doc-2", userId: "user-2", createdAt: new Date().toISOString() });
    await store.saveDocument("doc-3", { id: "doc-3", createdAt: new Date().toISOString() });

    const visible = await store.listDocuments({ userId: "user-1" });
    const ids = visible.map((d) => d.id).sort();
    assert.deepStrictEqual(ids, ["doc-1", "doc-3"]);
  });

  it("listDocuments without userId shows all", async () => {
    await store.saveDocument("doc-1", { id: "doc-1", userId: "user-1", createdAt: new Date().toISOString() });
    await store.saveDocument("doc-2", { id: "doc-2", userId: "user-2", createdAt: new Date().toISOString() });
    const all = await store.listDocuments();
    assert.equal(all.length, 2);
  });
});
