const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { DocumentService } = require("../src/services/documentService");

let tmpDir;
let store;
let documentService;

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "noia-doc-test-"));
  const dirs = ["runs", "agents", "exports", "topics", "templates", "users", "documents"];
  for (const d of dirs) await fs.mkdir(path.join(tmpDir, d), { recursive: true });

  const { FileStore } = require("../src/storage/fileStore");
  store = new FileStore(tmpDir);
  documentService = new DocumentService({ store, embeddingService: null });
}

async function cleanup() {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
}

describe("DocumentService", () => {
  beforeEach(async () => {
    await setup();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("ingestUpload stores a text file", async () => {
    const file = {
      buffer: Buffer.from("This is test content for a plain text document."),
      mimetype: "text/plain",
      originalname: "test.txt"
    };

    const result = await documentService.ingestUpload(file);
    assert.ok(result.id.startsWith("doc-"));
    assert.equal(result.filename, "test.txt");
    assert.ok(result.textLength > 0);
    assert.ok(result.createdAt);
  });

  it("ingestUpload throws for unsupported file type", async () => {
    const file = {
      buffer: Buffer.from("binary data"),
      mimetype: "application/octet-stream",
      originalname: "data.bin"
    };

    await assert.rejects(
      () => documentService.ingestUpload(file),
      (err) => err.statusCode === 400
    );
  });

  it("ingestUpload throws when no file provided", async () => {
    await assert.rejects(
      () => documentService.ingestUpload(null),
      (err) => err.statusCode === 400
    );
  });

  it("getDocument returns stored document", async () => {
    const file = {
      buffer: Buffer.from("Document content here."),
      mimetype: "text/plain",
      originalname: "readme.txt"
    };
    const result = await documentService.ingestUpload(file);

    const doc = await documentService.getDocument(result.id);
    assert.equal(doc.id, result.id);
    assert.equal(doc.extractedText, "Document content here.");
  });

  it("listDocuments returns all documents", async () => {
    await documentService.ingestUpload({
      buffer: Buffer.from("Doc 1"),
      mimetype: "text/plain",
      originalname: "a.txt"
    });
    await documentService.ingestUpload({
      buffer: Buffer.from("Doc 2"),
      mimetype: "text/plain",
      originalname: "b.txt"
    });

    const docs = await documentService.listDocuments();
    assert.equal(docs.length, 2);
    assert.ok(docs[0].id);
    assert.ok(docs[0].filename);
  });

  it("deleteDocument removes document", async () => {
    const result = await documentService.ingestUpload({
      buffer: Buffer.from("To delete"),
      mimetype: "text/plain",
      originalname: "del.txt"
    });

    await documentService.deleteDocument(result.id);

    await assert.rejects(
      () => documentService.getDocument(result.id),
      (err) => err.statusCode === 404
    );
  });

  it("getDocumentContext returns empty string for no docIds", async () => {
    const ctx = await documentService.getDocumentContext([], "query");
    assert.equal(ctx, "");
  });

  it("getDocumentContext returns truncated text without embeddings", async () => {
    const result = await documentService.ingestUpload({
      buffer: Buffer.from("Important research findings about neural networks and deep learning applications."),
      mimetype: "text/plain",
      originalname: "research.txt"
    });

    const ctx = await documentService.getDocumentContext([result.id], "neural networks");
    assert.ok(ctx.includes("Reference Documents"));
    assert.ok(ctx.includes("research.txt"));
    assert.ok(ctx.includes("neural networks"));
  });

  it("getDocumentContext handles missing documents gracefully", async () => {
    const ctx = await documentService.getDocumentContext(["doc-nonexistent"], "query");
    assert.equal(ctx, "");
  });

  it("ingestUpload accepts .md files", async () => {
    const file = {
      buffer: Buffer.from("# Heading\n\nSome markdown content."),
      mimetype: "text/markdown",
      originalname: "notes.md"
    };

    const result = await documentService.ingestUpload(file);
    assert.ok(result.id.startsWith("doc-"));
    assert.ok(result.textLength > 0);
  });

  it("ingestUpload with custom title", async () => {
    const file = {
      buffer: Buffer.from("Content"),
      mimetype: "text/plain",
      originalname: "file.txt"
    };

    const result = await documentService.ingestUpload(file, { title: "Custom Title" });
    assert.equal(result.title, "Custom Title");
  });
});

describe("DocumentService with SqliteStore", () => {
  let sqliteStore;
  let sqliteDocService;

  beforeEach(() => {
    const { SqliteStore } = require("../src/storage/sqliteStore");
    sqliteStore = new SqliteStore(":memory:");
    sqliteDocService = new DocumentService({ store: sqliteStore, embeddingService: null });
  });

  afterEach(() => {
    sqliteStore.close();
  });

  it("stores and retrieves document via SQLite", async () => {
    const file = {
      buffer: Buffer.from("SQLite document test content."),
      mimetype: "text/plain",
      originalname: "sqlite-test.txt"
    };

    const result = await sqliteDocService.ingestUpload(file);
    const doc = await sqliteDocService.getDocument(result.id);
    assert.equal(doc.extractedText, "SQLite document test content.");
  });

  it("lists and deletes documents via SQLite", async () => {
    await sqliteDocService.ingestUpload({
      buffer: Buffer.from("A"),
      mimetype: "text/plain",
      originalname: "a.txt"
    });
    const result = await sqliteDocService.ingestUpload({
      buffer: Buffer.from("B"),
      mimetype: "text/plain",
      originalname: "b.txt"
    });

    let docs = await sqliteDocService.listDocuments();
    assert.equal(docs.length, 2);

    await sqliteDocService.deleteDocument(result.id);
    docs = await sqliteDocService.listDocuments();
    assert.equal(docs.length, 1);
  });
});
