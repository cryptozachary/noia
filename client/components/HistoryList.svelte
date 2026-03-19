<script>
  import { historyRuns, currentRun, statusText, compareRunId, compareData } from "../stores.js";
  import { api } from "../lib/api.js";
  import { addToast } from "../lib/toastManager.js";
  import HistoryItem from "./HistoryItem.svelte";

  let searchQuery = "";

  $: filteredRuns = searchQuery
    ? $historyRuns.filter((r) =>
        (r.title || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.topic || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.id || "").toLowerCase().includes(searchQuery.toLowerCase())
      )
    : $historyRuns;

  async function loadRun(runId) {
    $statusText = "Loading Run";
    try {
      const data = await api.getRun(runId);
      $currentRun = data.run;
    } catch (error) {
      addToast(error.message || "Could not load run.", "error");
    } finally {
      $statusText = "Idle";
    }
  }

  async function deleteRun(runId) {
    const run = $historyRuns.find((r) => r.id === runId);
    if (!confirm(`Delete "${run?.title || run?.topic || runId}"?`)) return;
    try {
      await api.deleteRun(runId);
      addToast("Run deleted.");
      const data = await api.getRuns();
      $historyRuns = data.runs || [];
    } catch (error) {
      addToast(error.message || "Delete failed.", "error");
    }
  }

  async function onCompare(runId) {
    if (!$compareRunId) {
      $compareRunId = runId;
      addToast("Run selected. Click 'Compare' on another run.");
      return;
    }
    if ($compareRunId === runId) {
      $compareRunId = null;
      return;
    }
    try {
      $statusText = "Comparing...";
      const data = await api.compareRuns($compareRunId, runId);
      $compareData = data;
      $compareRunId = null;
    } catch (error) {
      addToast(error.message || "Comparison failed.", "error");
    } finally {
      $statusText = "Idle";
    }
  }
</script>

<h2>Session History</h2>
<input type="search" class="history-search" placeholder="Filter runs..." bind:value={searchQuery}
  aria-label="Filter session history" />
<div class="history-list" role="list">
  {#each filteredRuns as run (run.id)}
    <HistoryItem {run} compareRunId={$compareRunId}
      on:load={() => loadRun(run.id)}
      on:delete={() => deleteRun(run.id)}
      on:compare={() => onCompare(run.id)} />
  {:else}
    <p>No saved runs yet.</p>
  {/each}
</div>
