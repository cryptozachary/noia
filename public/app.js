const state = {
  currentRun: null,
  agents: []
};

const els = {
  statusBadge: document.getElementById("statusBadge"),
  form: document.getElementById("newDiscussionForm"),
  titleInput: document.getElementById("titleInput"),
  topicInput: document.getElementById("topicInput"),
  roundsInput: document.getElementById("roundsInput"),
  runMeta: document.getElementById("runMeta"),
  roundsContainer: document.getElementById("roundsContainer"),
  finalReport: document.getElementById("finalReport"),
  copyFinalBtn: document.getElementById("copyFinalBtn"),
  downloadFinalBtn: document.getElementById("downloadFinalBtn"),
  historyList: document.getElementById("historyList"),
  agentSelect: document.getElementById("agentSelect"),
  memoryEditor: document.getElementById("memoryEditor"),
  saveMemoryBtn: document.getElementById("saveMemoryBtn"),
  roundTemplate: document.getElementById("roundTemplate"),
  messageTemplate: document.getElementById("messageTemplate")
};

init();

async function init() {
  setStatus("Loading");
  await Promise.all([loadHistory(), loadAgents()]);
  wireEvents();
  setStatus("Idle");
}

function wireEvents() {
  els.form.addEventListener("submit", onCreateRun);
  els.agentSelect.addEventListener("change", onAgentChange);
  els.saveMemoryBtn.addEventListener("click", onSaveMemory);
  els.copyFinalBtn.addEventListener("click", copyFinalReport);
  els.downloadFinalBtn.addEventListener("click", downloadFinalReport);
}

async function onCreateRun(event) {
  event.preventDefault();
  const title = els.titleInput.value.trim();
  const topic = els.topicInput.value.trim();
  const rounds = Number(els.roundsInput.value || 4);

  if (!topic) {
    alert("Topic is required.");
    return;
  }

  setStatus("Running");
  toggleRunButtons(false);

  try {
    const response = await fetchJson("/api/discussions", {
      method: "POST",
      body: JSON.stringify({ title, topic, rounds })
    });

    state.currentRun = response.run;
    renderRun(response.run);
    await loadHistory();
  } catch (error) {
    alert(error.message || "Failed to run discussion.");
  } finally {
    setStatus("Idle");
  }
}

async function loadHistory() {
  const data = await fetchJson("/api/runs");
  const runs = data.runs || [];

  els.historyList.innerHTML = "";
  for (const run of runs) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "history-item";
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
        alert(error.message || "Could not load run.");
      } finally {
        setStatus("Idle");
      }
    });

    els.historyList.appendChild(item);
  }

  if (!runs.length) {
    els.historyList.innerHTML = "<p>No saved runs yet.</p>";
  }
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

function onAgentChange() {
  const agent = state.agents.find((item) => item.id === els.agentSelect.value);
  els.memoryEditor.value = agent ? agent.memory || "" : "";
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
    alert("Memory saved.");
  } catch (error) {
    alert(error.message || "Memory update failed.");
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
      msgFrag.querySelector("pre").textContent = message.content || "";
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

  const finalText = run.finalReport || "";
  els.finalReport.textContent = finalText;
  els.finalReport.classList.toggle("hidden", !finalText);
  toggleRunButtons(Boolean(finalText));
}

function toggleRunButtons(enabled) {
  els.copyFinalBtn.disabled = !enabled;
  els.downloadFinalBtn.disabled = !enabled;
}

async function copyFinalReport() {
  if (!state.currentRun || !state.currentRun.finalReport) {
    return;
  }

  await navigator.clipboard.writeText(state.currentRun.finalReport);
  alert("Final report copied.");
}

function downloadFinalReport() {
  if (!state.currentRun || !state.currentRun.finalReport) {
    return;
  }

  const blob = new Blob([state.currentRun.finalReport], { type: "text/markdown;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `${state.currentRun.id}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
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

function agentCssClass(agentId) {
  if (agentId === "research-synthesizer") {
    return "synth";
  }
  if (agentId === "skeptical-reviewer") {
    return "skeptic";
  }
  if (agentId === "innovation-strategist") {
    return "innov";
  }
  return "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
