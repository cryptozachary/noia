const state = {
  currentRun: null,
  agents: [],
  liveTokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  activeRunId: null,
  eventSource: null
};

const streamingCards = new Map();

const els = {
  statusBadge: document.getElementById("statusBadge"),
  form: document.getElementById("newDiscussionForm"),
  titleInput: document.getElementById("titleInput"),
  topicInput: document.getElementById("topicInput"),
  roundsInput: document.getElementById("roundsInput"),
  startBtn: document.getElementById("startBtn"),
  cancelBtn: document.getElementById("cancelBtn"),
  runMeta: document.getElementById("runMeta"),
  roundsContainer: document.getElementById("roundsContainer"),
  finalReport: document.getElementById("finalReport"),
  copyFinalBtn: document.getElementById("copyFinalBtn"),
  downloadFinalBtn: document.getElementById("downloadFinalBtn"),
  downloadHtmlBtn: document.getElementById("downloadHtmlBtn"),
  historyList: document.getElementById("historyList"),
  historySearch: document.getElementById("historySearch"),
  agentSelect: document.getElementById("agentSelect"),
  memoryEditor: document.getElementById("memoryEditor"),
  saveMemoryBtn: document.getElementById("saveMemoryBtn"),
  agentModelInput: document.getElementById("agentModelInput"),
  saveAgentConfigBtn: document.getElementById("saveAgentConfigBtn"),
  createAgentForm: document.getElementById("createAgentForm"),
  roundTemplate: document.getElementById("roundTemplate"),
  messageTemplate: document.getElementById("messageTemplate"),
  tokenSummary: document.getElementById("tokenSummary"),
  tokenTotal: document.getElementById("tokenTotal"),
  tokenInput: document.getElementById("tokenInput"),
  tokenOutput: document.getElementById("tokenOutput"),
  toastContainer: document.getElementById("toastContainer"),
  userInputArea: document.getElementById("userInputArea"),
  userInputText: document.getElementById("userInputText"),
  submitInputBtn: document.getElementById("submitInputBtn"),
  skipInputBtn: document.getElementById("skipInputBtn")
};

init();

async function init() {
  setStatus("Loading");
  await Promise.all([loadHistory(), loadAgents()]);
  wireEvents();
  await checkActiveRuns();
  setStatus("Idle");
}

function wireEvents() {
  els.form.addEventListener("submit", onCreateRun);
  els.cancelBtn.addEventListener("click", onCancelRun);
  els.agentSelect.addEventListener("change", onAgentChange);
  els.saveMemoryBtn.addEventListener("click", onSaveMemory);
  els.saveAgentConfigBtn.addEventListener("click", onSaveAgentConfig);
  els.copyFinalBtn.addEventListener("click", copyFinalReport);
  els.downloadFinalBtn.addEventListener("click", downloadFinalReport);
  els.downloadHtmlBtn.addEventListener("click", downloadHtmlReport);
  els.createAgentForm.addEventListener("submit", onCreateAgent);
  els.historySearch.addEventListener("input", onHistorySearch);
  els.submitInputBtn.addEventListener("click", onSubmitUserInput);
  els.skipInputBtn.addEventListener("click", onSkipUserInput);
}

// --- Item 2: Reconnect after page refresh ---
async function checkActiveRuns() {
  try {
    const data = await fetchJson("/api/discussions/active");
    const ids = data.activeRunIds || [];
    if (ids.length > 0) {
      const runId = ids[0];
      state.activeRunId = runId;
      setRunningUI(runId);
      connectSSE(runId);
      showToast("Reconnected to active discussion.");
    }
  } catch {
    // No active runs or endpoint unavailable
  }
}

async function onCreateRun(event) {
  event.preventDefault();
  const title = els.titleInput.value.trim();
  const topic = els.topicInput.value.trim();
  const rounds = Number(els.roundsInput.value || 4);

  if (!topic) {
    showToast("Topic is required.", "error");
    return;
  }

  // Item 5: Prevent duplicate submission
  if (state.activeRunId) {
    showToast("A discussion is already running.", "error");
    return;
  }

  setStatus("Starting...");
  setFormLocked(true);
  els.roundsContainer.innerHTML = "";
  els.finalReport.classList.add("hidden");
  els.tokenSummary.classList.add("hidden");
  state.liveTokens = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  let stages = null;
  const stagesRaw = (document.getElementById("stagesInput").value || "").trim();
  if (stagesRaw) {
    try {
      stages = JSON.parse(stagesRaw);
      if (!Array.isArray(stages)) {
        showToast("Stages must be a JSON array.", "error");
        setFormLocked(false);
        setStatus("Idle");
        return;
      }
    } catch {
      showToast("Invalid JSON in stages field.", "error");
      setFormLocked(false);
      setStatus("Idle");
      return;
    }
  }

  try {
    const response = await fetchJson("/api/discussions", {
      method: "POST",
      body: JSON.stringify({
        title, topic, rounds, stages,
        settings: {
          autoMemory: document.getElementById("autoMemoryCheck").checked,
          webSearch: document.getElementById("webSearchCheck").checked,
          interactive: document.getElementById("interactiveCheck").checked
        }
      })
    });

    const runId = response.runId;
    state.activeRunId = runId;
    setRunningUI(runId);
    connectSSE(runId);
  } catch (error) {
    setStatus("Idle");
    setFormLocked(false);
    showToast(error.message || "Failed to start discussion.", "error");
  }
}

function setRunningUI(runId) {
  const title = els.titleInput.value.trim();
  const topic = els.topicInput.value.trim();
  const rounds = els.roundsInput.value;

  els.runMeta.classList.remove("empty");
  els.runMeta.innerHTML = `
    <strong>${escapeHtml(title || topic || runId)}</strong><br />
    <span>${escapeHtml(runId)}</span><br />
    <span>Rounds: ${escapeHtml(rounds)} | Status: running</span>
  `;
}

function connectSSE(runId) {
  closeSSE();

  const source = new EventSource(`/api/discussions/${encodeURIComponent(runId)}/stream`);
  state.eventSource = source;
  let currentRoundCard = null;

  source.addEventListener("title-update", (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.title) {
        const metaStrong = els.runMeta.querySelector("strong");
        if (metaStrong) metaStrong.textContent = data.title;
        els.titleInput.value = data.title;
      }
    } catch {
      // SSE error handling hardening
    }
  });

  source.addEventListener("research-start", () => {
    setStatus("Searching sources...");
  });

  source.addEventListener("research-complete", (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.sourceCount > 0) {
        showToast(`Found ${data.sourceCount} research sources.`);
      }
    } catch {
      // SSE error handling hardening
    }
  });

  source.addEventListener("round-start", (e) => {
    try {
      const data = JSON.parse(e.data);
      currentRoundCard = appendRoundCard(data);
      setStatus(`Round ${data.round}: ${data.stage}`);
    } catch {
      // SSE error handling hardening
    }
  });

  source.addEventListener("agent-token", (e) => {
    try {
      const data = JSON.parse(e.data);
      const key = `${data.round}-${data.agentId}`;
      let card = streamingCards.get(key);
      if (!card && currentRoundCard) {
        const fragment = els.messageTemplate.content.cloneNode(true);
        const msgCard = fragment.querySelector(".msg-card");
        fragment.querySelector("h4").textContent = data.agentName || data.agentId;
        fragment.querySelector(".msg-time").textContent = "streaming...";
        msgCard.classList.add(agentCssClass(data.agentId), "streaming");
        const contentEl = fragment.querySelector(".msg-content");
        currentRoundCard.querySelector(".messages").appendChild(fragment);
        card = currentRoundCard.querySelector(".messages").lastElementChild;
        card._rawText = "";
        streamingCards.set(key, card);
      }
      if (card) {
        card._rawText += data.token;
        scheduleMarkdownUpdate(card.querySelector(".msg-content"), card);
      }
    } catch { /* SSE error handling */ }
  });

  source.addEventListener("agent-response", (e) => {
    try {
      const data = JSON.parse(e.data);
      const key = `${data.round}-${data.agentId}`;
      const streamCard = streamingCards.get(key);
      if (streamCard) {
        streamCard.classList.remove("streaming");
        streamCard.querySelector(".msg-time").textContent = new Date(data.timestamp).toLocaleTimeString();
        streamCard.querySelector(".msg-content").innerHTML = marked.parse(data.content || "");
        streamingCards.delete(key);
      } else if (currentRoundCard) {
        appendMessageToRound(currentRoundCard, data);
      }
      if (data.tokenUsage) updateLiveTokens(data.tokenUsage);
    } catch {
      // SSE error handling hardening
    }
  });

  source.addEventListener("coordinator-token", (e) => {
    try {
      const data = JSON.parse(e.data);
      els.finalReport.classList.remove("hidden");
      if (!els.finalReport._rawText) els.finalReport._rawText = "";
      els.finalReport._rawText += data.token;
      scheduleMarkdownUpdate(els.finalReport);
    } catch { /* SSE error handling */ }
  });

  source.addEventListener("tool-event", (e) => {
    try {
      const data = JSON.parse(e.data);
      const key = `${data.round}-${data.agentId}`;
      const card = streamingCards.get(key);
      if (card) {
        const timeEl = card.querySelector(".msg-time");
        timeEl.textContent = data.status === "searching" ? "Searching the web..." : "streaming...";
      }
    } catch { /* SSE error handling */ }
  });

  source.addEventListener("final-report", (e) => {
    try {
      const data = JSON.parse(e.data);
      els.finalReport._rawText = "";
      els.finalReport.innerHTML = marked.parse(data.report || "");
      els.finalReport.classList.remove("hidden");
      toggleRunButtons(true);
      if (data.tokenUsage) displayTokens(data.tokenUsage);
    } catch {
      // SSE error handling hardening
    }
  });

  source.addEventListener("round-paused", (e) => {
    try {
      const data = JSON.parse(e.data);
      els.userInputArea.classList.remove("hidden");
      els.userInputText.value = "";
      els.userInputText.focus();
      setStatus(`Paused after round ${data.round} — waiting for input`);
    } catch { /* SSE error handling */ }
  });

  source.addEventListener("round-resumed", (e) => {
    try {
      const data = JSON.parse(e.data);
      els.userInputArea.classList.add("hidden");
      showToast(`Round ${data.round} resuming${data.userInput ? " with your input" : ""}.`);
    } catch { /* SSE error handling */ }
  });

  source.addEventListener("memory-update-start", () => {
    setStatus("Updating agent memories...");
  });

  source.addEventListener("memory-update-complete", () => {
    showToast("Agent memories updated.");
  });

  source.addEventListener("run-complete", (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.tokenUsage) displayTokens(data.tokenUsage);
      loadRunById(runId);
    } catch {
      // Item 3: SSE error handling hardening
    }
    finishRun();
    showToast("Discussion completed.");
    loadHistory();
  });

  source.addEventListener("run-cancelled", () => {
    finishRun();
    showToast("Discussion cancelled.");
    loadHistory();
  });

  source.addEventListener("error", (e) => {
    try {
      const data = JSON.parse(e.data);
      showToast(data.message || "Discussion failed.", "error");
    } catch {
      showToast("Discussion failed or connection lost.", "error");
    }
    finishRun();
  });
}

function closeSSE() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function finishRun() {
  closeSSE();
  state.activeRunId = null;
  streamingCards.clear();
  els.userInputArea.classList.add("hidden");
  setStatus("Idle");
  setFormLocked(false);
}

function scheduleMarkdownUpdate(element, rawTextSource) {
  if (element._mdTimer) return;
  const source = rawTextSource || element;
  element._mdTimer = setTimeout(() => {
    element.innerHTML = marked.parse(source._rawText || "");
    element._mdTimer = null;
  }, 80);
}

async function onSubmitUserInput() {
  if (!state.activeRunId) return;
  const input = els.userInputText.value.trim();
  if (!input) {
    showToast("Please enter some input or click Skip.", "error");
    return;
  }
  try {
    await fetchJson(`/api/discussions/${encodeURIComponent(state.activeRunId)}/input`, {
      method: "POST",
      body: JSON.stringify({ input })
    });
  } catch (error) {
    showToast(error.message || "Failed to submit input.", "error");
  }
}

async function onSkipUserInput() {
  if (!state.activeRunId) return;
  try {
    await fetchJson(`/api/discussions/${encodeURIComponent(state.activeRunId)}/input`, {
      method: "POST",
      body: JSON.stringify({ input: "(No additional user input)" })
    });
  } catch (error) {
    showToast(error.message || "Failed to skip.", "error");
  }
}

// Item 1: Cancel running discussion
async function onCancelRun() {
  if (!state.activeRunId) return;

  try {
    await fetchJson(`/api/discussions/${encodeURIComponent(state.activeRunId)}`, {
      method: "DELETE"
    });
    showToast("Cancellation requested.");
  } catch (error) {
    showToast(error.message || "Cancel failed.", "error");
  }
}

// Item 5: Lock/unlock form during run
function setFormLocked(locked) {
  els.startBtn.disabled = locked;
  els.topicInput.disabled = locked;
  els.titleInput.disabled = locked;
  els.roundsInput.disabled = locked;
  els.cancelBtn.classList.toggle("hidden", !locked);
  toggleRunButtons(!locked && state.currentRun && state.currentRun.finalReport);
}

async function loadRunById(runId) {
  try {
    const data = await fetchJson(`/api/runs/${encodeURIComponent(runId)}`);
    state.currentRun = data.run;
  } catch { /* ignore */ }
}

function appendRoundCard(data) {
  const fragment = els.roundTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".round-card");
  card.querySelector("h3").textContent = `Round ${data.round}: ${data.stage}`;
  card.querySelector(".coordinator-line").textContent = data.coordinatorPrompt
    ? `Coordinator: ${data.coordinatorPrompt}`
    : "";
  els.roundsContainer.appendChild(fragment);
  const appended = els.roundsContainer.lastElementChild;
  appended.scrollIntoView({ behavior: "smooth", block: "end" });
  return appended;
}

function appendMessageToRound(roundCard, data) {
  const fragment = els.messageTemplate.content.cloneNode(true);
  const msgCard = fragment.querySelector(".msg-card");
  fragment.querySelector("h4").textContent = data.agentName || data.agentId;
  fragment.querySelector(".msg-time").textContent = new Date(data.timestamp).toLocaleTimeString();
  fragment.querySelector(".msg-content").innerHTML = marked.parse(data.content || "");
  msgCard.classList.add(agentCssClass(data.agentId));
  roundCard.querySelector(".messages").appendChild(fragment);
  roundCard.scrollIntoView({ behavior: "smooth", block: "end" });
}

function updateLiveTokens(usage) {
  state.liveTokens.input_tokens += usage.input_tokens || 0;
  state.liveTokens.output_tokens += usage.output_tokens || 0;
  state.liveTokens.total_tokens += usage.total_tokens || 0;
  displayTokens(state.liveTokens);
}

function displayTokens(usage) {
  els.tokenTotal.textContent = (usage.total_tokens || 0).toLocaleString();
  els.tokenInput.textContent = (usage.input_tokens || 0).toLocaleString();
  els.tokenOutput.textContent = (usage.output_tokens || 0).toLocaleString();
  els.tokenSummary.classList.remove("hidden");
}

let _historyRuns = [];

async function loadHistory() {
  const data = await fetchJson("/api/runs");
  const runs = data.runs || [];
  _historyRuns = runs;
  renderHistory(runs);
}

function renderHistory(runs) {
  els.historyList.innerHTML = "";
  for (const run of runs) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "history-item";
    item.setAttribute("role", "listitem");
    item.innerHTML = `
      <h4>${escapeHtml(run.title || run.topic)}</h4>
      <p>${escapeHtml(run.id)} | ${escapeHtml(run.status)} | ${new Date(run.createdAt).toLocaleString()}</p>
    `;

    item.addEventListener("click", async () => {
      setStatus("Loading Run");
      try {
        const dataById = await fetchJson(`/api/runs/${encodeURIComponent(run.id)}`);
        state.currentRun = dataById.run;
        renderRun(dataById.run);
      } catch (error) {
        showToast(error.message || "Could not load run.", "error");
      } finally {
        setStatus("Idle");
      }
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-run-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${run.title || run.topic}"?`)) return;
      try {
        await fetchJson(`/api/runs/${encodeURIComponent(run.id)}`, { method: "DELETE" });
        showToast("Run deleted.");
        await loadHistory();
      } catch (error) {
        showToast(error.message || "Delete failed.", "error");
      }
    });
    item.appendChild(deleteBtn);

    els.historyList.appendChild(item);
  }

  if (!runs.length) {
    els.historyList.innerHTML = "<p>No saved runs yet.</p>";
  }
}

// Item 9: Search/filter runs
function onHistorySearch() {
  const query = els.historySearch.value.trim().toLowerCase();
  if (!query) {
    renderHistory(_historyRuns);
    return;
  }
  const filtered = _historyRuns.filter(
    (run) =>
      (run.title || "").toLowerCase().includes(query) ||
      (run.topic || "").toLowerCase().includes(query) ||
      (run.id || "").toLowerCase().includes(query)
  );
  renderHistory(filtered);
}

async function loadAgents() {
  const data = await fetchJson("/api/agents");
  state.agents = data.agents || [];

  els.agentSelect.innerHTML = "";
  for (const agent of state.agents) {
    const option = document.createElement("option");
    option.value = agent.id;
    option.textContent = agent.name;
    els.agentSelect.appendChild(option);
  }

  if (state.agents.length) {
    els.memoryEditor.value = state.agents[0].memory || "";
  }
}

async function onAgentChange() {
  const agentId = els.agentSelect.value;
  const agent = state.agents.find((item) => item.id === agentId);
  els.memoryEditor.value = agent ? agent.memory || "" : "";
  try {
    const data = await fetchJson(`/api/agents/${encodeURIComponent(agentId)}/config`);
    els.agentModelInput.value = (data.agent && data.agent.config && data.agent.config.model) || "";
  } catch {
    els.agentModelInput.value = "";
  }
}

async function onCreateAgent(event) {
  event.preventDefault();
  const name = document.getElementById("newAgentName").value.trim();
  const purpose = document.getElementById("newAgentPurpose").value.trim();
  const identity = document.getElementById("newAgentIdentity").value;
  const system = document.getElementById("newAgentSystem").value;
  const model = document.getElementById("newAgentModel").value.trim();

  if (!name || !system) {
    showToast("Agent name and system prompt are required.", "error");
    return;
  }

  try {
    await fetchJson("/api/agents", {
      method: "POST",
      body: JSON.stringify({ name, purpose, identity, system, model: model || undefined })
    });
    await loadAgents();
    els.createAgentForm.reset();
    showToast("Agent created.");
  } catch (error) {
    showToast(error.message || "Failed to create agent.", "error");
  }
}

async function onSaveAgentConfig() {
  const agentId = els.agentSelect.value;
  if (!agentId) return;
  try {
    await fetchJson(`/api/agents/${encodeURIComponent(agentId)}/config`, {
      method: "PUT",
      body: JSON.stringify({ model: els.agentModelInput.value.trim() })
    });
    showToast("Agent model saved.");
  } catch (error) {
    showToast(error.message || "Config update failed.", "error");
  }
}

async function onSaveMemory() {
  const agentId = els.agentSelect.value;
  if (!agentId) {
    return;
  }

  setStatus("Saving Memory");
  try {
    await fetchJson(`/api/agents/${encodeURIComponent(agentId)}/memory`, {
      method: "PUT",
      body: JSON.stringify({ memory: els.memoryEditor.value })
    });
    const local = state.agents.find((agent) => agent.id === agentId);
    if (local) {
      local.memory = els.memoryEditor.value;
    }
    showToast("Memory saved.");
  } catch (error) {
    showToast(error.message || "Memory update failed.", "error");
  } finally {
    setStatus("Idle");
  }
}

function renderRun(run) {
  if (!run) {
    return;
  }

  els.runMeta.classList.remove("empty");
  els.runMeta.innerHTML = `
    <strong>${escapeHtml(run.title || run.topic)}</strong><br />
    <span>${escapeHtml(run.id)}</span><br />
    <span>Rounds: ${escapeHtml(String(run.rounds || 0))} | Status: ${escapeHtml(run.metadata ? run.metadata.status : "unknown")}</span>
  `;

  els.roundsContainer.innerHTML = "";
  for (const round of run.roundMessages || []) {
    const fragment = els.roundTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".round-card");
    card.querySelector("h3").textContent = `Round ${round.round}: ${round.stage}`;
    card.querySelector(".coordinator-line").textContent = `Coordinator: ${round.coordinatorPrompt || "n/a"}`;

    const messagesHost = card.querySelector(".messages");
    for (const message of round.messages || []) {
      const msgFrag = els.messageTemplate.content.cloneNode(true);
      const msgCard = msgFrag.querySelector(".msg-card");
      msgFrag.querySelector("h4").textContent = message.agentName || message.agentId;
      msgFrag.querySelector(".msg-time").textContent = new Date(message.timestamp).toLocaleTimeString();
      msgFrag.querySelector(".msg-content").innerHTML = marked.parse(message.content || "");
      msgCard.classList.add(agentCssClass(message.agentId));
      messagesHost.appendChild(msgFrag);
    }

    if (!(round.messages || []).length) {
      const empty = document.createElement("p");
      empty.textContent = "No agent messages in this stage.";
      messagesHost.appendChild(empty);
    }

    els.roundsContainer.appendChild(fragment);
  }

  const usage = run.metadata && run.metadata.tokenUsage;
  if (usage && usage.total_tokens > 0) {
    els.tokenTotal.textContent = usage.total_tokens.toLocaleString();
    els.tokenInput.textContent = usage.input_tokens.toLocaleString();
    els.tokenOutput.textContent = usage.output_tokens.toLocaleString();
    els.tokenSummary.classList.remove("hidden");
  } else {
    els.tokenSummary.classList.add("hidden");
  }

  const finalText = run.finalReport || "";
  els.finalReport.innerHTML = finalText ? marked.parse(finalText) : "";
  els.finalReport.classList.toggle("hidden", !finalText);
  toggleRunButtons(Boolean(finalText));
}

function toggleRunButtons(enabled) {
  els.copyFinalBtn.disabled = !enabled;
  els.downloadFinalBtn.disabled = !enabled;
  els.downloadHtmlBtn.disabled = !enabled;
}

async function copyFinalReport() {
  if (!state.currentRun || !state.currentRun.finalReport) {
    return;
  }

  await navigator.clipboard.writeText(state.currentRun.finalReport);
  showToast("Final report copied.");
}

function downloadFinalReport() {
  if (!state.currentRun) return;
  window.open(`/api/runs/${encodeURIComponent(state.currentRun.id)}/export/md`, "_blank");
}

function downloadHtmlReport() {
  if (!state.currentRun) return;
  window.open(`/api/runs/${encodeURIComponent(state.currentRun.id)}/export/html`, "_blank");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function setStatus(text) {
  els.statusBadge.textContent = text;
}

// Item 10: Toast notifications
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", "alert");
  toast.textContent = message;
  els.toastContainer.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

function agentCssClass(agentId) {
  const map = {
    "research-synthesizer": "synth",
    "skeptical-reviewer": "skeptic",
    "innovation-strategist": "innov"
  };
  return map[agentId] || "custom";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
