import { writable, derived } from "svelte/store";

// Core run state
export const currentRun = writable(null);
export const activeRunId = writable(null);
export const currentModel = writable("");

// Live streaming
export const liveTokens = writable({ input_tokens: 0, output_tokens: 0, total_tokens: 0 });
export const sseRounds = writable([]);
export const sseFinalReport = writable("");
export const sseIsPaused = writable(false);
export const ssePausedRound = writable(null);

// Collections
export const agents = writable([]);
export const historyRuns = writable([]);
export const templates = writable([]);

// Comparison
export const compareRunId = writable(null);
export const compareData = writable(null);

// UI
export const statusText = writable("Idle");
export const toasts = writable([]);
export const selectedAgentId = writable("");

// Derived
export const isRunning = derived(activeRunId, ($id) => $id !== null);
