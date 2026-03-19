<script>
  export let metrics;

  $: items = [
    { label: "Consensus", value: metrics.consensusScore, pct: true },
    { label: "Evidence Density", value: metrics.evidenceDensity, pct: true },
    { label: "Claim Diversity", value: metrics.claimDiversity, pct: true },
    { label: "Convergence", value: metrics.convergenceRate, pct: true },
    { label: "Total Claims", value: metrics.totalClaims, pct: false },
    { label: "Total Edges", value: metrics.totalEdges, pct: false }
  ];
</script>

<div class="metrics-grid">
  {#each items as item}
    <div class="metric-card">
      <div class="metric-label">{item.label}</div>
      <div class="metric-value">{item.pct ? Math.round(item.value * 100) + "%" : item.value}</div>
      {#if item.pct}
        <div class="metric-bar">
          <div class="metric-bar-fill" style="width:{Math.round(item.value * 100)}%"></div>
        </div>
      {/if}
    </div>
  {/each}
</div>
