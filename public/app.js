const state = {
  currentRun: null,
  agents: [],
  liveTokens: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  activeRunId: null,
  eventSource: null,
  currentModel: "",
  compareRunId: null
};

const streamingCards = new Map();

// --- Cost calculation (client-side, mirrors costCalculator.js) ---
const PRICING = {
  "gpt-4.1": { input: 2.00, output: 8.00 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60 },
  "gpt-4.1-nano": { input: 0.10, output: 0.40 },
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "o3": { input: 2.00, output: 8.00 },
  "o3-mini": { input: 1.10, output: 4.40 },
  "o4-mini": { input: 1.10, output: 4.40 },
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
  "claude-3-5-sonnet-20241022": { input: 3.00, output: 15.00 },
  "claude-3-5-haiku-20241022": { input: 0.80, output: 4.00 },
  "claude-3-opus-20240229": { input: 15.00, output: 75.00 }
};

function clientCalculateCost(model, usage) {
  if (!model || !usage) return 0;
  const key = model.toLowerCase();
  let pricing = PRICING[key];
  if (!pricing) {
    const keys = Object.keys(PRICING).sort((a, b) => b.length - a.length);
    for (const prefix of keys) {
      if (key.startsWith(prefix)) { pricing = PRICING[prefix]; break; }
    }
  }
  if (!pricing) return 0;
  return ((usage.input_tokens || 0) / 1e6) * pricing.input + ((usage.output_tokens || 0) / 1e6) * pricing.output;
}

function formatCost(cost) {
  if (!cost || cost === 0) return "";
  if (cost < 0.01) return `~$${cost.toFixed(4)}`;
  return `~$${cost.toFixed(2)}`;
}

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
  tokenCost: document.getElementById("tokenCost"),
  costEstimate: document.getElementById("costEstimate"),
  estimatedCost: document.getElementById("estimatedCost"),
  userInputArea: document.getElementById("userInputArea"),
  userInputText: document.getElementById("userInputText"),
  submitInputBtn: document.getElementById("submitInputBtn"),
  skipInputBtn: document.getElementById("skipInputBtn"),
  templateSelect: document.getElementById("templateSelect"),
  saveTemplateBtn: document.getElementById("saveTemplateBtn"),
  deleteTemplateBtn: document.getElementById("deleteTemplateBtn"),
  evaluationPanel: document.getElementById("evaluationPanel"),
  metricsDisplay: document.getElementById("metricsDisplay"),
  graphCanvas: document.getElementById("graphCanvas"),
  graphTooltip: document.getElementById("graphTooltip"),
  agentInsights: document.getElementById("agentInsights"),
  compareOverlay: document.getElementById("compareOverlay"),
  closeCompareBtn: document.getElementById("closeCompareBtn"),
  compareDivergence: document.getElementById("compareDivergence"),
  compareColA: document.getElementById("compareColA"),
  compareColB: document.getElementById("compareColB")
};

init();

async function init() {
  setStatus("Loading");
  await Promise.all([loadHistory(), loadAgents(), loadTemplates()]);
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
  els.topicInput.addEventListener("input", updateCostEstimate);
  els.roundsInput.addEventListener("input", updateCostEstimate);
  els.closeCompareBtn.addEventListener("click", () => els.compareOverlay.classList.add("hidden"));
  els.saveTemplateBtn.addEventListener("click", onSaveTemplate);
  els.templateSelect.addEventListener("change", onLoadTemplate);
  els.deleteTemplateBtn.addEventListener("click", onDeleteTemplate);
  updateCostEstimate();
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
  state.currentModel = "";
  els.costEstimate.classList.add("hidden");

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

  source.addEventListener("compression-start", () => {
    setStatus("Compressing context...");
  });

  source.addEventListener("compression-complete", () => {
    showToast("Context compressed.");
  });

  source.addEventListener("evaluation-start", () => {
    setStatus("Evaluating discussion...");
  });

  source.addEventListener("evaluation-complete", (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.metrics) renderMetrics(data.metrics);
      if (data.graph) renderArgumentGraph(data.graph);
      els.evaluationPanel.classList.remove("hidden");
      showToast("Discussion evaluation complete.");
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

async function updateCostEstimate() {
  const topic = els.topicInput.value.trim();
  const rounds = Number(els.roundsInput.value || 4);
  if (!topic) {
    els.costEstimate.classList.add("hidden");
    return;
  }
  try {
    const data = await fetchJson(`/api/cost/estimate?topicLength=${topic.length}&rounds=${rounds}&agentCount=3`);
    if (data.estimate && data.estimate.estimatedCost > 0) {
      els.estimatedCost.textContent = formatCost(data.estimate.estimatedCost);
      els.costEstimate.classList.remove("hidden");
    } else {
      els.costEstimate.classList.add("hidden");
    }
  } catch {
    els.costEstimate.classList.add("hidden");
  }
}

// --- Templates ---
let _templates = [];

async function loadTemplates() {
  try {
    const data = await fetchJson("/api/templates");
    _templates = data.templates || [];
    els.templateSelect.innerHTML = '<option value="">-- Load Template --</option>';
    for (const tmpl of _templates) {
      const opt = document.createElement("option");
      opt.value = tmpl.id;
      opt.textContent = tmpl.name;
      els.templateSelect.appendChild(opt);
    }
    els.deleteTemplateBtn.classList.add("hidden");
  } catch { /* no templates */ }
}

async function onSaveTemplate() {
  const name = prompt("Template name:");
  if (!name || !name.trim()) return;
  const stagesRaw = (document.getElementById("stagesInput").value || "").trim();
  let stages = null;
  if (stagesRaw) {
    try { stages = JSON.parse(stagesRaw); } catch { /* ignore */ }
  }
  try {
    await fetchJson("/api/templates", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        topic: els.topicInput.value.trim(),
        rounds: Number(els.roundsInput.value || 4),
        stages,
        settings: {
          autoMemory: document.getElementById("autoMemoryCheck").checked,
          webSearch: document.getElementById("webSearchCheck").checked,
          interactive: document.getElementById("interactiveCheck").checked
        }
      })
    });
    showToast("Template saved.");
    await loadTemplates();
  } catch (error) {
    showToast(error.message || "Failed to save template.", "error");
  }
}

function onLoadTemplate() {
  const id = els.templateSelect.value;
  if (!id) {
    els.deleteTemplateBtn.classList.add("hidden");
    return;
  }
  const tmpl = _templates.find((t) => t.id === id);
  if (!tmpl) return;
  els.topicInput.value = tmpl.topic || "";
  els.roundsInput.value = tmpl.rounds || 4;
  els.titleInput.value = "";
  document.getElementById("stagesInput").value = tmpl.stages ? JSON.stringify(tmpl.stages, null, 2) : "";
  if (tmpl.settings) {
    document.getElementById("autoMemoryCheck").checked = tmpl.settings.autoMemory !== false;
    document.getElementById("webSearchCheck").checked = tmpl.settings.webSearch === true;
    document.getElementById("interactiveCheck").checked = tmpl.settings.interactive === true;
  }
  els.deleteTemplateBtn.classList.remove("hidden");
  updateCostEstimate();
}

async function onDeleteTemplate() {
  const id = els.templateSelect.value;
  if (!id) return;
  const tmpl = _templates.find((t) => t.id === id);
  if (!confirm(`Delete template "${tmpl ? tmpl.name : id}"?`)) return;
  try {
    await fetchJson(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
    showToast("Template deleted.");
    await loadTemplates();
  } catch (error) {
    showToast(error.message || "Failed to delete template.", "error");
  }
}

// --- Branching ---
async function onBranchFromRound(runId, round) {
  if (state.activeRunId) {
    showToast("Cannot branch while a discussion is running.", "error");
    return;
  }
  if (!confirm(`Branch from round ${round}? This creates a new discussion continuing from that point.`)) return;
  try {
    setStatus("Branching...");
    const response = await fetchJson(`/api/runs/${encodeURIComponent(runId)}/branch`, {
      method: "POST",
      body: JSON.stringify({ round })
    });
    const newRunId = response.runId;
    state.activeRunId = newRunId;
    setRunningUI(newRunId);
    connectSSE(newRunId);
    setFormLocked(true);
    showToast(`Branched from round ${round}. New run started.`);
    loadHistory();
  } catch (error) {
    setStatus("Idle");
    showToast(error.message || "Branch failed.", "error");
  }
}

function wireBranchBtn(roundCard, runId, round) {
  const btn = roundCard.querySelector(".branch-btn");
  if (!btn) return;
  if (state.activeRunId) btn.disabled = true;
  btn.addEventListener("click", () => onBranchFromRound(runId, round));
}

// --- Annotations ---
function wireAnnotateBtn(msgCard, runId, round, agentId) {
  const btn = msgCard.querySelector(".annotate-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    // Toggle form
    let form = msgCard.querySelector(".annotation-form");
    if (form) { form.remove(); return; }
    form = document.createElement("div");
    form.className = "annotation-form";
    form.innerHTML = `<textarea placeholder="Add a note..." rows="2"></textarea><button type="button">Save</button><button type="button">Cancel</button>`;
    const [saveBtn, cancelBtn] = form.querySelectorAll("button");
    cancelBtn.addEventListener("click", () => form.remove());
    saveBtn.addEventListener("click", async () => {
      const text = form.querySelector("textarea").value.trim();
      if (!text) return;
      try {
        const result = await fetchJson(`/api/runs/${encodeURIComponent(runId)}/annotations`, {
          method: "POST",
          body: JSON.stringify({ round, agentId, text })
        });
        form.remove();
        appendAnnotationToCard(msgCard, runId, result.annotation);
      } catch (error) {
        showToast(error.message || "Failed to save annotation.", "error");
      }
    });
    msgCard.appendChild(form);
    form.querySelector("textarea").focus();
  });
}

function appendAnnotationToCard(msgCard, runId, ann) {
  const list = msgCard.querySelector(".annotations-list");
  if (!list) return;
  const el = document.createElement("div");
  el.className = "annotation";
  el.dataset.annotationId = ann.id;
  el.innerHTML = `<span class="annotation-text">${escapeHtml(ann.text)}</span><span class="annotation-time">${new Date(ann.timestamp).toLocaleString()}</span><button class="annotation-delete" title="Delete">×</button>`;
  el.querySelector(".annotation-delete").addEventListener("click", async () => {
    try {
      await fetchJson(`/api/runs/${encodeURIComponent(runId)}/annotations/${ann.id}`, { method: "DELETE" });
      el.remove();
    } catch (error) {
      showToast(error.message || "Failed to delete annotation.", "error");
    }
  });
  list.appendChild(el);
}

async function loadAnnotationsForRun(runId) {
  try {
    const data = await fetchJson(`/api/runs/${encodeURIComponent(runId)}/annotations`);
    const annotations = data.annotations || [];
    for (const ann of annotations) {
      const cards = document.querySelectorAll(`.msg-card[data-round="${ann.round}"][data-agent-id="${ann.agentId}"]`);
      for (const card of cards) {
        appendAnnotationToCard(card, runId, ann);
      }
    }
  } catch { /* no annotations */ }
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
  msgCard.dataset.round = data.round || "";
  msgCard.dataset.agentId = data.agentId || "";
  fragment.querySelector("h4").textContent = data.agentName || data.agentId;
  fragment.querySelector(".msg-time").textContent = new Date(data.timestamp).toLocaleTimeString();
  fragment.querySelector(".msg-content").innerHTML = marked.parse(data.content || "");
  msgCard.classList.add(agentCssClass(data.agentId));
  roundCard.querySelector(".messages").appendChild(fragment);
  const appended = roundCard.querySelector(".messages").lastElementChild;
  if (state.currentRun || state.activeRunId) {
    wireAnnotateBtn(appended, (state.currentRun && state.currentRun.id) || state.activeRunId, data.round, data.agentId);
  }
  roundCard.scrollIntoView({ behavior: "smooth", block: "end" });
}

function updateLiveTokens(usage) {
  state.liveTokens.input_tokens += usage.input_tokens || 0;
  state.liveTokens.output_tokens += usage.output_tokens || 0;
  state.liveTokens.total_tokens += usage.total_tokens || 0;
  displayTokens(state.liveTokens);
}

function displayTokens(usage, model) {
  els.tokenTotal.textContent = (usage.total_tokens || 0).toLocaleString();
  els.tokenInput.textContent = (usage.input_tokens || 0).toLocaleString();
  els.tokenOutput.textContent = (usage.output_tokens || 0).toLocaleString();
  const costModel = model || state.currentModel || "";
  const cost = clientCalculateCost(costModel, usage);
  els.tokenCost.textContent = cost > 0 ? ` | Cost: ${formatCost(cost)}` : "";
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
    const branchInfo = run.branchedFrom ? `<span class="branch-indicator">branched from round ${run.branchedFrom.round}</span>` : "";
    item.innerHTML = `
      <h4>${escapeHtml(run.title || run.topic)}</h4>
      <p>${escapeHtml(run.id)} | ${escapeHtml(run.status)} | ${new Date(run.createdAt).toLocaleString()}</p>
      ${branchInfo}
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

    const compareBtn = document.createElement("button");
    compareBtn.type = "button";
    compareBtn.className = "compare-run-btn";
    compareBtn.textContent = state.compareRunId && state.compareRunId !== run.id ? "Compare" : "Select";
    compareBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onCompareClick(run.id);
    });
    item.appendChild(compareBtn);

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
    loadAgentInsights(state.agents[0].id);
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
  loadAgentInsights(agentId);
}

async function loadAgentInsights(agentId) {
  try {
    const data = await fetchJson(`/api/agents/${encodeURIComponent(agentId)}/insights`);
    const ins = data.insights;
    const sizeDisplay = ins.totalSize < 1024 ? `${ins.totalSize} B` : `${(ins.totalSize / 1024).toFixed(1)} KB`;
    els.agentInsights.innerHTML = `
      <div class="insight-row"><span>Memory Size</span><strong>${sizeDisplay}</strong></div>
      <div class="insight-row"><span>Sections</span><strong>${ins.sectionCount}</strong></div>
      <div class="insight-row"><span>Discussions</span><strong>${ins.sessionCount}</strong></div>
      <div class="insight-row"><span>Topics</span><strong>${escapeHtml((ins.topicKeywords || []).slice(0, 5).join(", ") || "None")}</strong></div>
    `;
    els.agentInsights.classList.remove("hidden");
  } catch {
    els.agentInsights.classList.add("hidden");
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
      msgCard.dataset.round = round.round;
      msgCard.dataset.agentId = message.agentId;
      messagesHost.appendChild(msgFrag);
      const appendedMsg = messagesHost.lastElementChild;
      wireAnnotateBtn(appendedMsg, run.id, round.round, message.agentId);
    }

    if (!(round.messages || []).length) {
      const empty = document.createElement("p");
      empty.textContent = "No agent messages in this stage.";
      messagesHost.appendChild(empty);
    }

    els.roundsContainer.appendChild(fragment);
    const appendedRound = els.roundsContainer.lastElementChild;
    wireBranchBtn(appendedRound, run.id, round.round);
  }

  const usage = run.metadata && run.metadata.tokenUsage;
  if (usage && usage.total_tokens > 0) {
    displayTokens(usage, run.metadata.model);
  } else {
    els.tokenSummary.classList.add("hidden");
  }

  const finalText = run.finalReport || "";
  els.finalReport.innerHTML = finalText ? marked.parse(finalText) : "";
  els.finalReport.classList.toggle("hidden", !finalText);
  toggleRunButtons(Boolean(finalText));

  // Evaluation panel
  if (run.metadata && run.metadata.evaluationMetrics) {
    renderMetrics(run.metadata.evaluationMetrics);
    if (run.metadata.argumentGraph) renderArgumentGraph(run.metadata.argumentGraph);
    els.evaluationPanel.classList.remove("hidden");
  } else {
    els.evaluationPanel.classList.add("hidden");
  }

  loadAnnotationsForRun(run.id);
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

// --- Run Comparison ---
async function onCompareClick(runId) {
  if (!state.compareRunId) {
    state.compareRunId = runId;
    showToast("Run selected. Click 'Compare' on another run.");
    renderHistory(_historyRuns);
    return;
  }
  if (state.compareRunId === runId) {
    state.compareRunId = null;
    renderHistory(_historyRuns);
    return;
  }
  try {
    setStatus("Comparing...");
    const data = await fetchJson(`/api/runs/compare?a=${encodeURIComponent(state.compareRunId)}&b=${encodeURIComponent(runId)}`);
    renderComparison(data);
    state.compareRunId = null;
    renderHistory(_historyRuns);
  } catch (error) {
    showToast(error.message || "Comparison failed.", "error");
  } finally {
    setStatus("Idle");
  }
}

function renderComparison(data) {
  const { runA, runB, divergenceRound } = data;
  if (divergenceRound !== null) {
    els.compareDivergence.innerHTML = `<p>Runs diverged after <strong>round ${divergenceRound}</strong></p>`;
  } else {
    els.compareDivergence.innerHTML = `<p>These runs are independent (no branch relationship).</p>`;
  }
  els.compareColA.innerHTML = renderCompareColumn(runA.run, runA.cost);
  els.compareColB.innerHTML = renderCompareColumn(runB.run, runB.cost);
  els.compareOverlay.classList.remove("hidden");
}

function renderCompareColumn(run, cost) {
  const metrics = run.metadata && run.metadata.evaluationMetrics;
  const metricsHtml = metrics ? renderCompareMetrics(metrics) : "<p>No evaluation metrics.</p>";
  const finalHtml = run.finalReport ? marked.parse(run.finalReport) : "<p>No final report.</p>";
  const costStr = cost ? formatCost(cost.totalCost || cost) : "N/A";
  return `
    <h3>${escapeHtml(run.title || run.topic)}</h3>
    <p class="compare-meta">${escapeHtml(run.id)}</p>
    <p class="compare-meta">Status: ${escapeHtml(run.metadata ? run.metadata.status : "unknown")} | Cost: ${costStr}</p>
    <h4>Metrics</h4>
    ${metricsHtml}
    <h4>Final Report</h4>
    <div class="compare-report">${finalHtml}</div>
  `;
}

function renderCompareMetrics(metrics) {
  const items = [
    { label: "Consensus", value: metrics.consensusScore },
    { label: "Evidence Density", value: metrics.evidenceDensity },
    { label: "Diversity", value: metrics.claimDiversity },
    { label: "Convergence", value: metrics.convergenceRate },
    { label: "Claims", value: metrics.totalClaims, raw: true },
    { label: "Edges", value: metrics.totalEdges, raw: true }
  ];
  return `<div class="compare-metrics">${items.map((m) => {
    const display = m.raw ? m.value : `${Math.round(m.value * 100)}%`;
    const bar = m.raw ? "" : `<div class="metric-bar"><div class="metric-bar-fill" style="width:${Math.round(m.value * 100)}%"></div></div>`;
    return `<div class="compare-metric"><span>${m.label}</span><strong>${display}</strong>${bar}</div>`;
  }).join("")}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// --- Evaluation Rendering ---
function renderMetrics(metrics) {
  const items = [
    { label: "Consensus", value: metrics.consensusScore, pct: true },
    { label: "Evidence Density", value: metrics.evidenceDensity, pct: true },
    { label: "Claim Diversity", value: metrics.claimDiversity, pct: true },
    { label: "Convergence", value: metrics.convergenceRate, pct: true },
    { label: "Total Claims", value: metrics.totalClaims, pct: false },
    { label: "Total Edges", value: metrics.totalEdges, pct: false }
  ];
  els.metricsDisplay.innerHTML = items.map((m) => {
    const display = m.pct ? `${Math.round(m.value * 100)}%` : String(m.value);
    const bar = m.pct
      ? `<div class="metric-bar"><div class="metric-bar-fill" style="width:${Math.round(m.value * 100)}%"></div></div>`
      : "";
    return `<div class="metric-card"><div class="metric-label">${escapeHtml(m.label)}</div><div class="metric-value">${display}</div>${bar}</div>`;
  }).join("");
}

function renderArgumentGraph(graph) {
  const canvas = els.graphCanvas;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const nodes = (graph.nodes || []).slice(0, 50);
  const edges = graph.edges || [];
  if (nodes.length === 0) { ctx.clearRect(0, 0, W, H); return; }

  // Assign colors by agent
  const agentColors = {};
  const palette = ["#1f7a5a", "#97410e", "#425bb3", "#585068", "#6b7280", "#0e5a7a", "#8b5cf6", "#d97706"];
  let ci = 0;
  for (const n of nodes) {
    if (!agentColors[n.agentId]) agentColors[n.agentId] = palette[ci++ % palette.length];
  }

  // Initialize positions randomly
  const sim = nodes.map((n, i) => ({
    ...n,
    x: W * 0.2 + Math.random() * W * 0.6,
    y: H * 0.2 + Math.random() * H * 0.6,
    vx: 0, vy: 0,
    idx: i
  }));
  const idMap = {};
  sim.forEach((n, i) => { idMap[n.id] = i; });

  // Simple force simulation
  const ITERATIONS = 120;
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const alpha = 1 - iter / ITERATIONS;
    // Repulsion between all nodes
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        let dx = sim[j].x - sim[i].x;
        let dy = sim[j].y - sim[i].y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (800 * alpha) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        sim[i].vx -= fx; sim[i].vy -= fy;
        sim[j].vx += fx; sim[j].vy += fy;
      }
    }
    // Edge attraction
    for (const edge of edges) {
      const si = idMap[edge.source];
      const ti = idMap[edge.target];
      if (si === undefined || ti === undefined) continue;
      let dx = sim[ti].x - sim[si].x;
      let dy = sim[ti].y - sim[si].y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 80) * 0.02 * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      sim[si].vx += fx; sim[si].vy += fy;
      sim[ti].vx -= fx; sim[ti].vy -= fy;
    }
    // Gravity toward center
    for (const n of sim) {
      n.vx += (W / 2 - n.x) * 0.005 * alpha;
      n.vy += (H / 2 - n.y) * 0.005 * alpha;
    }
    // Apply velocity with damping
    for (const n of sim) {
      n.vx *= 0.6; n.vy *= 0.6;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(20, Math.min(W - 20, n.x));
      n.y = Math.max(20, Math.min(H - 20, n.y));
    }
  }

  // Draw
  ctx.clearRect(0, 0, W, H);

  // Edges
  const edgeColors = { supports: "#22c55e", contradicts: "#ef4444", extends: "#3b82f6" };
  for (const edge of edges) {
    const si = idMap[edge.source];
    const ti = idMap[edge.target];
    if (si === undefined || ti === undefined) continue;
    ctx.beginPath();
    ctx.moveTo(sim[si].x, sim[si].y);
    ctx.lineTo(sim[ti].x, sim[ti].y);
    ctx.strokeStyle = edgeColors[edge.type] || "#999";
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Nodes
  const confRadius = { high: 10, medium: 7, low: 5 };
  for (const n of sim) {
    const r = confRadius[n.confidence] || 7;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = agentColors[n.agentId] || "#6b7280";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Legend
  ctx.font = "11px sans-serif";
  let lx = 10, ly = H - 10;
  for (const [type, color] of Object.entries(edgeColors)) {
    ctx.beginPath(); ctx.moveTo(lx, ly - 4); ctx.lineTo(lx + 18, ly - 4);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#333"; ctx.fillText(type, lx + 22, ly);
    lx += ctx.measureText(type).width + 36;
  }

  // Store sim for tooltip
  canvas._simNodes = sim;
  canvas._agentColors = agentColors;

  // Hover tooltip
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    let hit = null;
    for (const n of canvas._simNodes) {
      const dx = mx - n.x, dy = my - n.y;
      if (dx * dx + dy * dy < 144) { hit = n; break; }
    }
    if (hit) {
      els.graphTooltip.textContent = `[${hit.type}] ${hit.text}`;
      els.graphTooltip.style.left = `${e.clientX - canvas.parentElement.getBoundingClientRect().left + 12}px`;
      els.graphTooltip.style.top = `${e.clientY - canvas.parentElement.getBoundingClientRect().top - 20}px`;
      els.graphTooltip.classList.remove("hidden");
    } else {
      els.graphTooltip.classList.add("hidden");
    }
  };
  canvas.onmouseleave = () => els.graphTooltip.classList.add("hidden");
}
