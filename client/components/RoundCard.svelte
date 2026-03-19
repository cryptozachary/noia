<script>
  import { activeRunId, historyRuns } from "../stores.js";
  import { api } from "../lib/api.js";
  import { connectSSE } from "../lib/sse.js";
  import { addToast } from "../lib/toastManager.js";
  import MessageCard from "./MessageCard.svelte";

  export let round;
  export let runId;

  async function branch() {
    if ($activeRunId) { addToast("Cannot branch while a discussion is running.", "error"); return; }
    if (!confirm(`Branch from round ${round.round}? This creates a new discussion continuing from that point.`)) return;
    try {
      const response = await api.branchRun(runId, round.round);
      $activeRunId = response.runId;
      connectSSE(response.runId);
      addToast(`Branched from round ${round.round}. New run started.`);
      const data = await api.getRuns();
      $historyRuns = data.runs || [];
    } catch (error) {
      addToast(error.message || "Branch failed.", "error");
    }
  }
</script>

<section class="round-card">
  <header>
    <h3>Round {round.round}: {round.stage}</h3>
    <button class="branch-btn" type="button" title="Branch from this round"
      on:click={branch} disabled={!!$activeRunId}>Branch</button>
    {#if round.coordinatorPrompt}
      <p class="coordinator-line">Coordinator: {round.coordinatorPrompt}</p>
    {/if}
  </header>
  <div class="messages">
    {#each round.messages || [] as message (message.agentId + '-' + (message.timestamp || ''))}
      <MessageCard {message} {runId} round={round.round} />
    {:else}
      <p>No agent messages in this stage.</p>
    {/each}
  </div>
</section>
