export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

export const api = {
  // Runs
  getRuns: (page = 1, limit = 50) => fetchJson(`/api/runs?page=${page}&limit=${limit}`),
  getRun: (id) => fetchJson(`/api/runs/${encodeURIComponent(id)}`),
  deleteRun: (id) => fetchJson(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  compareRuns: (a, b) => fetchJson(`/api/runs/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
  branchRun: (id, round) => fetchJson(`/api/runs/${encodeURIComponent(id)}/branch`, { method: "POST", body: JSON.stringify({ round }) }),

  // Discussions
  createDiscussion: (body) => fetchJson("/api/discussions", { method: "POST", body: JSON.stringify(body) }),
  getActiveRuns: () => fetchJson("/api/discussions/active"),
  cancelRun: (id) => fetchJson(`/api/discussions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  submitInput: (id, input) => fetchJson(`/api/discussions/${encodeURIComponent(id)}/input`, { method: "POST", body: JSON.stringify({ input }) }),

  // Agents
  getAgents: () => fetchJson("/api/agents"),
  getAgentConfig: (id) => fetchJson(`/api/agents/${encodeURIComponent(id)}/config`),
  saveAgentMemory: (id, memory) => fetchJson(`/api/agents/${encodeURIComponent(id)}/memory`, { method: "PUT", body: JSON.stringify({ memory }) }),
  saveAgentConfig: (id, model) => fetchJson(`/api/agents/${encodeURIComponent(id)}/config`, { method: "PUT", body: JSON.stringify({ model }) }),
  getAgentInsights: (id) => fetchJson(`/api/agents/${encodeURIComponent(id)}/insights`),
  createAgent: (body) => fetchJson("/api/agents", { method: "POST", body: JSON.stringify(body) }),
  getSnapshots: (id) => fetchJson(`/api/agents/${encodeURIComponent(id)}/snapshots`),
  createSnapshot: (id, label) => fetchJson(`/api/agents/${encodeURIComponent(id)}/snapshot`, { method: "POST", body: JSON.stringify({ label }) }),
  restoreSnapshot: (id, snapId) => fetchJson(`/api/agents/${encodeURIComponent(id)}/restore/${encodeURIComponent(snapId)}`, { method: "POST" }),
  pruneMemory: (id, options) => fetchJson(`/api/agents/${encodeURIComponent(id)}/prune-memory`, { method: "POST", body: JSON.stringify(options || {}) }),

  // Annotations
  getAnnotations: (id) => fetchJson(`/api/runs/${encodeURIComponent(id)}/annotations`),
  addAnnotation: (id, body) => fetchJson(`/api/runs/${encodeURIComponent(id)}/annotations`, { method: "POST", body: JSON.stringify(body) }),
  deleteAnnotation: (runId, annId) => fetchJson(`/api/runs/${encodeURIComponent(runId)}/annotations/${annId}`, { method: "DELETE" }),

  // Evaluation
  getEvaluation: (id) => fetchJson(`/api/runs/${encodeURIComponent(id)}/evaluation`),
  runEvaluation: (id) => fetchJson(`/api/runs/${encodeURIComponent(id)}/evaluate`, { method: "POST" }),

  // Cost & Usage
  getCostEstimate: (params) => fetchJson(`/api/cost/estimate?${new URLSearchParams(params)}`),
  getUsage: () => fetchJson("/api/usage"),

  // Templates
  getTemplates: () => fetchJson("/api/templates"),
  saveTemplate: (body) => fetchJson("/api/templates", { method: "POST", body: JSON.stringify(body) }),
  deleteTemplate: (id) => fetchJson(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Documents
  getDocuments: () => fetchJson("/api/documents"),
  getDocument: (id) => fetchJson(`/api/documents/${encodeURIComponent(id)}`),
  deleteDocument: (id) => fetchJson(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  importArxiv: (arxivId) => fetchJson("/api/documents/arxiv", { method: "POST", body: JSON.stringify({ arxivId }) }),
  uploadDocument: async (file, title) => {
    const formData = new FormData();
    formData.append("file", file);
    if (title) formData.append("title", title);
    const response = await fetch("/api/documents/upload", { method: "POST", body: formData });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Upload failed.");
    return payload;
  },

  // Export URLs (not fetched, opened directly)
  exportMdUrl: (id) => `/api/runs/${encodeURIComponent(id)}/export/md`,
  exportHtmlUrl: (id) => `/api/runs/${encodeURIComponent(id)}/export/html`
};
