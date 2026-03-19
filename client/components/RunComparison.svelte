<script>
  import { marked } from "marked";
  import { compareData } from "../stores.js";
  import { formatCost } from "../lib/costs.js";
  import { escapeHtml } from "../lib/utils.js";
  import MetricsDisplay from "./MetricsDisplay.svelte";

  function close() { $compareData = null; }

  function renderCostStr(cost) {
    if (!cost) return "N/A";
    return formatCost(cost.totalCost || cost) || "N/A";
  }
</script>

{#if $compareData}
  <div class="compare-overlay" on:click|self={close}>
    <div class="compare-container">
      <div class="compare-header">
        <h2>Run Comparison</h2>
        <button type="button" on:click={close}>Close</button>
      </div>

      {#if $compareData.divergenceRound !== null}
        <div class="compare-divergence">
          <p>Runs diverged after <strong>round {$compareData.divergenceRound}</strong></p>
        </div>
      {:else}
        <div class="compare-divergence">
          <p>These runs are independent (no branch relationship).</p>
        </div>
      {/if}

      <div class="compare-columns">
        {#each [{ data: $compareData.runA, label: "A" }, { data: $compareData.runB, label: "B" }] as col}
          {@const run = col.data.run}
          {@const cost = col.data.cost}
          <div class="compare-col">
            <h3>{run.title || run.topic}</h3>
            <p class="compare-meta">{run.id}</p>
            <p class="compare-meta">Status: {run.metadata ? run.metadata.status : "unknown"} | Cost: {renderCostStr(cost)}</p>
            <h4>Metrics</h4>
            {#if run.metadata?.evaluationMetrics}
              <MetricsDisplay metrics={run.metadata.evaluationMetrics} />
            {:else}
              <p>No evaluation metrics.</p>
            {/if}
            <h4>Final Report</h4>
            <div class="compare-report">
              {#if run.finalReport}
                {@html marked.parse(run.finalReport)}
              {:else}
                <p>No final report.</p>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
