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

  // Annotations
  getAnnotations: (id) => fetchJson(`/api/runs/${encodeURIComponent(id)}/annotations`),
  addAnnotation: (id, body) => fetchJson(`/api/runs/${encodeURIComponent(id)}/annotations`, { method: "POST", body: JSON.stringify(body) }),
  deleteAnnotation: (runId, annId) => fetchJson(`/api/runs/${encodeURIComponent(runId)}/annotations/${annId}`, { method: "DELETE" }),

  // Evaluation
  getEvaluation: (id) => fetchJson(`/api/runs/${encodeURIComponent(id)}/evaluation`),
  runEvaluation: (id) => fetchJson(`/api/runs/${encodeURIComponent(id)}/evaluate`, { method: "POST" }),

  // Cost
  getCostEstimate: (params) => fetchJson(`/api/cost/estimate?${new URLSearchParams(params)}`),

  // Templates
  getTemplates: () => fetchJson("/api/templates"),
  saveTemplate: (body) => fetchJson("/api/templates", { method: "POST", body: JSON.stringify(body) }),
  deleteTemplate: (id) => fetchJson(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Export URLs (not fetched, opened directly)
  exportMdUrl: (id) => `/api/runs/${encodeURIComponent(id)}/export/md`,
  exportHtmlUrl: (id) => `/api/runs/${encodeURIComponent(id)}/export/html`
};
