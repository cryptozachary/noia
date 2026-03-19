<script>
  import { activeRunId, statusText, liveTokens, currentModel, currentRun, historyRuns } from "../stores.js";
  import { api } from "../lib/api.js";
  import { connectSSE } from "../lib/sse.js";
  import { addToast } from "../lib/toastManager.js";
  import { formatCost } from "../lib/costs.js";
  import TemplateSection from "./TemplateSection.svelte";

  let title = "";
  let topic = "";
  let rounds = 4;
  let autoMemory = true;
  let webSearch = false;
  let interactive = false;
  let stagesRaw = "";
  let estimatedCost = "";

  $: formLocked = $activeRunId !== null;

  async function updateCostEstimate() {
    if (!topic.trim()) { estimatedCost = ""; return; }
    try {
      const data = await api.getCostEstimate({ topicLength: topic.length, rounds, agentCount: 3 });
      if (data.estimate && data.estimate.estimatedCost > 0) {
        estimatedCost = formatCost(data.estimate.estimatedCost);
      } else {
        estimatedCost = "";
      }
    } catch { estimatedCost = ""; }
  }

  async function onSubmit() {
    if (!topic.trim()) { addToast("Topic is required.", "error"); return; }
    if ($activeRunId) { addToast("A discussion is already running.", "error"); return; }

    let stages = null;
    if (stagesRaw.trim()) {
      try {
        stages = JSON.parse(stagesRaw);
        if (!Array.isArray(stages)) throw new Error();
      } catch {
        addToast("Invalid JSON in stages field.", "error");
        return;
      }
    }

    $statusText = "Starting...";
    $liveTokens = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    $currentModel = "";
    estimatedCost = "";

    try {
      const response = await api.createDiscussion({
        title, topic, rounds, stages,
        settings: { autoMemory, webSearch, interactive }
      });
      $activeRunId = response.runId;
      $currentRun = null;
      connectSSE(response.runId);
    } catch (error) {
      $statusText = "Idle";
      addToast(error.message || "Failed to start discussion.", "error");
    }
  }

  async function onCancel() {
    if (!$activeRunId) return;
    try {
      await api.cancelRun($activeRunId);
      addToast("Cancellation requested.");
    } catch (error) {
      addToast(error.message || "Cancel failed.", "error");
    }
  }

  function loadTemplate(event) {
    const tmpl = event.detail;
    topic = tmpl.topic || "";
    rounds = tmpl.rounds || 4;
    title = "";
    stagesRaw = tmpl.stages ? JSON.stringify(tmpl.stages, null, 2) : "";
    if (tmpl.settings) {
      autoMemory = tmpl.settings.autoMemory !== false;
      webSearch = tmpl.settings.webSearch === true;
      interactive = tmpl.settings.interactive === true;
    }
    updateCostEstimate();
  }
</script>

<h2>New Discussion</h2>
<form id="newDiscussionForm" on:submit|preventDefault={onSubmit} aria-label="Create new discussion">
  <label>Title (optional)</label>
  <input type="text" bind:value={title} placeholder="e.g., Next-gen solid-state battery ideas" disabled={formLocked} />

  <label>Topic</label>
  <textarea rows="6" required bind:value={topic} on:input={updateCostEstimate}
    placeholder="Describe the research topic, constraints, and goals..." disabled={formLocked}></textarea>

  <label>Rounds (2-8)</label>
  <input type="number" min="2" max="8" bind:value={rounds} on:input={updateCostEstimate} disabled={formLocked} />

  <label class="checkbox-label">
    <input type="checkbox" bind:checked={autoMemory} />
    Auto-update agent memory after run
  </label>

  <label class="checkbox-label">
    <input type="checkbox" bind:checked={webSearch} />
    Enable agent web search
  </label>

  <label class="checkbox-label">
    <input type="checkbox" bind:checked={interactive} />
    Interactive mode (pause between rounds)
  </label>

  <details class="stages-details">
    <summary>Custom Stages (optional)</summary>
    <textarea rows="4" bind:value={stagesRaw}
      placeholder='[{"{"}name":"brainstorm","instruction":"Generate wild ideas"{"}"},{"{"}name":"critique","instruction":"Find flaws"{"}"},{"{"}name":"final-synthesis"{"}"}]'></textarea>
    <p class="stages-hint">JSON array with one entry per round. Each: <code>{`{"name":"...","instruction":"..."}`}</code></p>
  </details>

  {#if estimatedCost}
    <div class="cost-estimate">
      Estimated cost: <strong>{estimatedCost}</strong>
    </div>
  {/if}

  <TemplateSection {topic} {rounds} {stagesRaw} {autoMemory} {webSearch} {interactive}
    on:select={loadTemplate} />

  <div class="form-actions">
    <button type="submit" class="btn-primary" disabled={formLocked}>Start Discussion</button>
    {#if formLocked}
      <button type="button" class="cancel-btn" on:click={onCancel} aria-label="Cancel running discussion">Cancel</button>
    {/if}
  </div>
</form>

<div class="hint-box">
  <h3>Safety note</h3>
  <p>This lab is for exploratory research discussions. It does not produce clinical or medical advice.</p>
</div>
