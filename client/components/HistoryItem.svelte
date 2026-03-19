<script>
  import { createEventDispatcher } from "svelte";

  export let run;
  export let compareRunId = null;

  const dispatch = createEventDispatcher();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="history-item" role="listitem" on:click={() => dispatch("load")}
  on:keydown={(e) => e.key === 'Enter' && dispatch("load")} tabindex="0">
  <h4>{run.title || run.topic}</h4>
  <p>{run.id} | {run.status} | {new Date(run.createdAt).toLocaleString()}</p>
  {#if run.branchedFrom}
    <span class="branch-indicator">branched from round {run.branchedFrom.round}</span>
  {/if}
  <button type="button" class="delete-run-btn" on:click|stopPropagation={() => dispatch("delete")}>Delete</button>
  <button type="button" class="compare-run-btn" on:click|stopPropagation={() => dispatch("compare")}>
    {compareRunId && compareRunId !== run.id ? "Compare" : "Select"}
  </button>
</div>
