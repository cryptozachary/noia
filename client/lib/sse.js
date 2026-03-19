import { get } from "svelte/store";
import {
  activeRunId, currentRun, currentModel, liveTokens,
  sseRounds, sseFinalReport, sseIsPaused, ssePausedRound,
  statusText, historyRuns
} from "../stores.js";
import { api } from "./api.js";
import { addToast } from "./toastManager.js";

let eventSource = null;

export function connectSSE(runId) {
  closeSSE();

  const source = new EventSource(`/api/discussions/${encodeURIComponent(runId)}/stream`);
  eventSource = source;

  source.addEventListener("title-update", (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.title) {
        currentRun.update((r) => r ? { ...r, title: data.title } : r);
      }
    } catch { /* ignore */ }
  });

  source.addEventListener("research-start", () => {
    statusText.set("Searching sources...");
  });

  source.addEventListener("research-complete", (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.sourceCount > 0) addToast(`Found ${data.sourceCount} research sources.`);
    } catch { /* ignore */ }
  });

  source.addEventListener("agent-retry", (e) => {
    try {
      const data = JSON.parse(e.data);
      addToast(`Retrying ${data.agentName} (attempt ${data.attempt}/${data.maxRetries})...`, "warning");
    } catch { /* ignore */ }
  });

  source.addEventListener("round-start", (e) => {
    try {
      const data = JSON.parse(e.data);
      sseRounds.update((rounds) => [
        ...rounds,
        { round: data.round, stage: data.stage, coordinatorPrompt: data.coordinatorPrompt || "", messages: [] }
      ]);
      statusText.set(`Round ${data.round}: ${data.stage}`);
    } catch { /* ignore */ }
  });

  source.addEventListener("agent-token", (e) => {
    try {
      const data = JSON.parse(e.data);
      sseRounds.update((rounds) => {
        const updated = [...rounds];
        const currentRound = updated.find((r) => r.round === data.round);
        if (!currentRound) return updated;
        let msg = currentRound.messages.find((m) => m.agentId === data.agentId && m._streaming);
        if (!msg) {
          msg = {
            agentId: data.agentId,
            agentName: data.agentName || data.agentId,
            content: "",
            _streaming: true,
            timestamp: new Date().toISOString()
          };
          currentRound.messages = [...currentRound.messages, msg];
        }
        msg.content += data.token;
        return updated;
      });
      if (data.model) currentModel.set(data.model);
    } catch { /* ignore */ }
  });

  source.addEventListener("agent-response", (e) => {
    try {
      const data = JSON.parse(e.data);
      sseRounds.update((rounds) => {
        const updated = [...rounds];
        const currentRound = updated.find((r) => r.round === data.round);
        if (!currentRound) return updated;
        const idx = currentRound.messages.findIndex((m) => m.agentId === data.agentId && m._streaming);
        const finalized = {
          agentId: data.agentId,
          agentName: data.agentName || data.agentId,
          content: data.content || "",
          timestamp: data.timestamp,
          tokenUsage: data.tokenUsage,
          _streaming: false
        };
        if (idx >= 0) {
          currentRound.messages[idx] = finalized;
        } else {
          currentRound.messages = [...currentRound.messages, finalized];
        }
        return updated;
      });
      if (data.tokenUsage) {
        liveTokens.update((t) => ({
          input_tokens: t.input_tokens + (data.tokenUsage.input_tokens || 0),
          output_tokens: t.output_tokens + (data.tokenUsage.output_tokens || 0),
          total_tokens: t.total_tokens + (data.tokenUsage.total_tokens || 0)
        }));
      }
      if (data.model) currentModel.set(data.model);
    } catch { /* ignore */ }
  });

  source.addEventListener("coordinator-token", (e) => {
    try {
      const data = JSON.parse(e.data);
      sseFinalReport.update((text) => text + data.token);
    } catch { /* ignore */ }
  });

  source.addEventListener("tool-event", () => {
    // Tool events are visual-only in the vanilla version; store state unchanged
  });

  source.addEventListener("final-report", (e) => {
    try {
      const data = JSON.parse(e.data);
      sseFinalReport.set(data.report || "");
      if (data.tokenUsage) {
        liveTokens.set({
          input_tokens: data.tokenUsage.input_tokens || 0,
          output_tokens: data.tokenUsage.output_tokens || 0,
          total_tokens: data.tokenUsage.total_tokens || 0
        });
      }
    } catch { /* ignore */ }
  });

  source.addEventListener("round-paused", (e) => {
    try {
      const data = JSON.parse(e.data);
      sseIsPaused.set(true);
      ssePausedRound.set(data.round);
      statusText.set(`Paused after round ${data.round} — waiting for input`);
    } catch { /* ignore */ }
  });

  source.addEventListener("round-resumed", (e) => {
    try {
      const data = JSON.parse(e.data);
      sseIsPaused.set(false);
      ssePausedRound.set(null);
      addToast(`Round ${data.round} resuming${data.userInput ? " with your input" : ""}.`);
    } catch { /* ignore */ }
  });

  source.addEventListener("compression-start", () => {
    statusText.set("Compressing context...");
  });

  source.addEventListener("compression-complete", () => {
    addToast("Context compressed.");
  });

  source.addEventListener("evaluation-start", () => {
    statusText.set("Evaluating discussion...");
  });

  source.addEventListener("evaluation-complete", (e) => {
    try {
      const data = JSON.parse(e.data);
      currentRun.update((r) => {
        if (!r) return r;
        const metadata = { ...(r.metadata || {}) };
        if (data.metrics) metadata.evaluationMetrics = data.metrics;
        if (data.graph) metadata.argumentGraph = data.graph;
        return { ...r, metadata };
      });
      addToast("Discussion evaluation complete.");
    } catch { /* ignore */ }
  });

  source.addEventListener("memory-update-start", () => {
    statusText.set("Updating agent memories...");
  });

  source.addEventListener("memory-update-complete", () => {
    addToast("Agent memories updated.");
  });

  source.addEventListener("run-complete", async (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.tokenUsage) {
        liveTokens.set({
          input_tokens: data.tokenUsage.input_tokens || 0,
          output_tokens: data.tokenUsage.output_tokens || 0,
          total_tokens: data.tokenUsage.total_tokens || 0
        });
      }
      // Fetch full run to replace SSE-accumulated state
      const result = await api.getRun(runId);
      currentRun.set(result.run);
    } catch { /* ignore */ }
    finishRun();
    addToast("Discussion completed.");
    refreshHistory();
  });

  source.addEventListener("run-cancelled", () => {
    finishRun();
    addToast("Discussion cancelled.");
    refreshHistory();
  });

  source.addEventListener("error", (e) => {
    try {
      const data = JSON.parse(e.data);
      addToast(data.message || "Discussion failed.", "error");
    } catch {
      addToast("Discussion failed or connection lost.", "error");
    }
    finishRun();
  });
}

export function closeSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function finishRun() {
  closeSSE();
  activeRunId.set(null);
  sseRounds.set([]);
  sseFinalReport.set("");
  sseIsPaused.set(false);
  ssePausedRound.set(null);
  statusText.set("Idle");
}

async function refreshHistory() {
  try {
    const data = await api.getRuns();
    historyRuns.set(data.runs || []);
  } catch { /* ignore */ }
}
