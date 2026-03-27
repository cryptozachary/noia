const { randomUUID } = require("crypto");
const fs = require("fs/promises");
const pdfParse = require("pdf-parse");
const { AppError } = require("../utils/errors");
const { logger } = require("../utils/logger");

class DocumentService {
  constructor({ store, embeddingService }) {
    this.store = store;
    this.embeddingService = embeddingService || null;
  }

  async ingestUpload(file, metadata = {}) {
    if (!file || (!file.buffer && !file.path)) {
      throw new AppError("No file provided", 400);
    }

    const id = `doc-${randomUUID().slice(0, 8)}`;
    let extractedText = "";

    // Read file content from disk (multer disk storage) or memory buffer
    const buffer = file.buffer || await fs.readFile(file.path);

    const mimeType = file.mimetype || "";
    const filename = file.originalname || "upload";

    try {
      if (mimeType === "application/pdf" || filename.endsWith(".pdf")) {
        extractedText = await this._extractPdfText(buffer);
      } else if (mimeType.startsWith("text/") || filename.endsWith(".txt") || filename.endsWith(".md")) {
        extractedText = buffer.toString("utf8");
      } else {
        throw new AppError(`Unsupported file type: ${mimeType || filename}`, 400);
      }
    } finally {
      // Clean up temp file from disk storage
      if (file.path) {
        fs.unlink(file.path).catch(() => {});
      }
    }

    const doc = {
      id,
      filename,
      source: "upload",
      title: metadata.title || filename,
      textLength: extractedText.length,
      extractedText,
      chunks: [],
      createdAt: new Date().toISOString()
    };
    if (metadata.userId) doc.userId = metadata.userId;

    if (this.embeddingService && extractedText.length > 0) {
      try {
        doc.chunks = await this._chunkAndEmbed(extractedText);
      } catch (err) {
        logger.warn("Document embedding failed, storing without embeddings", { error: err.message });
      }
    }

    await this.store.saveDocument(id, doc);
    return { id: doc.id, filename: doc.filename, title: doc.title, textLength: doc.textLength, chunksCount: doc.chunks.length, createdAt: doc.createdAt };
  }

  async ingestArxiv(arxivId, { userId } = {}) {
    if (!arxivId || typeof arxivId !== "string") {
      throw new AppError("Invalid arXiv ID", 400);
    }

    // Normalize: strip "arXiv:" prefix if present
    const cleanId = arxivId.replace(/^arxiv:/i, "").trim();
    const pdfUrl = `https://arxiv.org/pdf/${cleanId}.pdf`;

    let response;
    try {
      response = await fetch(pdfUrl);
    } catch (err) {
      throw new AppError(`Failed to fetch arXiv paper: ${err.message}`, 502);
    }
    if (!response.ok) {
      throw new AppError(`arXiv returned ${response.status} for ${cleanId}`, 404);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const extractedText = await this._extractPdfText(buffer);

    const id = `doc-${randomUUID().slice(0, 8)}`;
    const doc = {
      id,
      filename: `${cleanId}.pdf`,
      source: "arxiv",
      arxivId: cleanId,
      title: `arXiv:${cleanId}`,
      textLength: extractedText.length,
      extractedText,
      chunks: [],
      createdAt: new Date().toISOString()
    };
    if (userId) doc.userId = userId;

    if (this.embeddingService && extractedText.length > 0) {
      try {
        doc.chunks = await this._chunkAndEmbed(extractedText);
      } catch (err) {
        logger.warn("Document embedding failed, storing without embeddings", { error: err.message });
      }
    }

    await this.store.saveDocument(id, doc);
    return { id: doc.id, filename: doc.filename, source: doc.source, arxivId: doc.arxivId, title: doc.title, textLength: doc.textLength, chunksCount: doc.chunks.length, createdAt: doc.createdAt };
  }

  async getDocument(docId) {
    return await this.store.loadDocument(docId);
  }

  async listDocuments({ userId } = {}) {
    const docs = await this.store.listDocuments({ userId });
    return docs.map((d) => ({
      id: d.id,
      filename: d.filename,
      source: d.source,
      title: d.title,
      textLength: d.textLength,
      chunksCount: (d.chunks || []).length,
      createdAt: d.createdAt,
      userId: d.userId || null
    }));
  }

  async deleteDocument(docId) {
    await this.store.deleteDocument(docId);
  }

  async getDocumentContext(docIds, query, maxChars = 8000) {
    if (!docIds || docIds.length === 0) return "";

    const sections = [];
    for (const docId of docIds) {
      try {
        const doc = await this.store.loadDocument(docId);
        if (!doc) continue;

        let text = "";
        if (query && doc.chunks && doc.chunks.length > 0 && this.embeddingService) {
          // Vector search within document chunks
          try {
            const queryEmbedding = await this.embeddingService.embed(query);
            const relevant = this.embeddingService.searchSimilar(queryEmbedding, doc.chunks, 5);
            text = relevant.map((r) => r.text).join("\n\n");
          } catch {
            // Fall back to truncated text
            text = (doc.extractedText || "").slice(0, Math.floor(maxChars / docIds.length));
          }
        } else {
          text = (doc.extractedText || "").slice(0, Math.floor(maxChars / docIds.length));
        }

        if (text) {
          sections.push(`## Document: ${doc.title || doc.filename}\n\n${text}`);
        }
      } catch (err) {
        logger.warn("Failed to load document for context", { docId, error: err.message });
      }
    }

    return sections.length > 0 ? `# Reference Documents\n\n${sections.join("\n\n---\n\n")}` : "";
  }

  async _extractPdfText(buffer) {
    try {
      const data = await pdfParse(buffer);
      return (data.text || "").trim();
    } catch (err) {
      throw new AppError(`PDF extraction failed: ${err.message}`, 422);
    }
  }

  async _chunkAndEmbed(text, chunkSize = 1000) {
    const chunks = [];
    const paragraphs = text.split(/\n\n+/);
    let current = "";

    for (const para of paragraphs) {
      if (current.length + para.length > chunkSize && current.length > 0) {
        chunks.push(current.trim());
        current = para;
      } else {
        current += (current ? "\n\n" : "") + para;
      }
    }
    if (current.trim()) chunks.push(current.trim());

    // Filter out very short chunks
    const meaningful = chunks.filter((c) => c.length > 50);

    const embedded = [];
    for (const chunk of meaningful) {
      try {
        const embedding = await this.embeddingService.embed(chunk);
        embedded.push({ text: chunk, embedding });
      } catch {
        embedded.push({ text: chunk, embedding: [] });
      }
    }
    return embedded;
  }
}

module.exports = { DocumentService };
