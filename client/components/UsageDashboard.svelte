<script>
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { formatCost } from "../lib/costs.js";

  export let onClose;

  let loading = true;
  let error = null;
  let data = null;

  onMount(async () => {
    try {
      data = await api.getUsage();
    } catch (e) {
      error = e.message;
    }
    loading = false;
  });

  function fmtTokens(n) {
    if (!n) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  function fmtCost(c) {
    if (!c || c === 0) return "$0.00";
    if (c < 0.01) return `$${c.toFixed(4)}`;
    return `$${c.toFixed(2)}`;
  }

  $: modelEntries = data ? Object.entries(data.byModel).sort((a, b) => b[1].totalCost - a[1].totalCost) : [];
  $: dayEntries = data ? Object.entries(data.byDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30) : [];
  $: maxDayCost = dayEntries.length > 0 ? Math.max(...dayEntries.map(([, d]) => d.totalCost)) : 1;
</script>

<div class="usage-overlay" on:click|self={onClose} role="button" tabindex="-1" on:keydown={(e) => e.key === "Escape" && onClose()}>
  <div class="usage-panel">
    <div class="usage-header">
      <h2>Usage Dashboard</h2>
      <button class="close-btn" on:click={onClose} aria-label="Close">&times;</button>
    </div>

    {#if loading}
      <p class="usage-loading">Loading usage data...</p>
    {:else if error}
      <p class="usage-error">Failed to load usage data: {error}</p>
    {:else if data}
      <div class="usage-body">
        <!-- Summary Cards -->
        <div class="summary-cards">
          <div class="summary-card">
            <span class="card-label">Total Runs</span>
            <span class="card-value">{data.totals.runCount}</span>
          </div>
          <div class="summary-card">
            <span class="card-label">Total Cost</span>
            <span class="card-value cost">{fmtCost(data.totals.totalCost)}</span>
          </div>
          <div class="summary-card">
            <span class="card-label">Total Tokens</span>
            <span class="card-value">{fmtTokens(data.totals.total_tokens)}</span>
          </div>
          <div class="summary-card">
            <span class="card-label">Avg Cost/Run</span>
            <span class="card-value">{data.totals.runCount > 0 ? fmtCost(data.totals.totalCost / data.totals.runCount) : "$0.00"}</span>
          </div>
        </div>

        <!-- Token Breakdown -->
        <div class="usage-section">
          <h3>Token Breakdown</h3>
          <div class="token-bar">
            <div class="token-segment input" style="flex:{data.totals.input_tokens || 1}">
              <span>Input: {fmtTokens(data.totals.input_tokens)}</span>
            </div>
            <div class="token-segment output" style="flex:{data.totals.output_tokens || 1}">
              <span>Output: {fmtTokens(data.totals.output_tokens)}</span>
            </div>
          </div>
        </div>

        <!-- By Model -->
        {#if modelEntries.length > 0}
          <div class="usage-section">
            <h3>By Model</h3>
            <table class="usage-table">
              <thead>
                <tr><th>Model</th><th>Runs</th><th>Tokens</th><th>Cost</th></tr>
              </thead>
              <tbody>
                {#each modelEntries as [model, stats]}
                  <tr>
                    <td class="model-name">{model}</td>
                    <td>{stats.runCount}</td>
                    <td>{fmtTokens(stats.total_tokens)}</td>
                    <td class="cost">{fmtCost(stats.totalCost)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        <!-- Daily Usage Chart -->
        {#if dayEntries.length > 0}
          <div class="usage-section">
            <h3>Daily Usage (last 30 days)</h3>
            <div class="day-chart">
              {#each dayEntries.slice().reverse() as [day, stats]}
                <div class="day-row">
                  <span class="day-label">{day.slice(5)}</span>
                  <div class="day-bar-track">
                    <div class="day-bar-fill" style="width:{maxDayCost > 0 ? (stats.totalCost / maxDayCost * 100) : 0}%"></div>
                  </div>
                  <span class="day-cost">{fmtCost(stats.totalCost)}</span>
                  <span class="day-runs">{stats.runCount}r</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Recent Runs -->
        {#if data.recentRuns.length > 0}
          <div class="usage-section">
            <h3>Recent Runs</h3>
            <table class="usage-table">
              <thead>
                <tr><th>Title</th><th>Model</th><th>Tokens</th><th>Cost</th><th>Date</th></tr>
              </thead>
              <tbody>
                {#each data.recentRuns as run}
                  <tr>
                    <td class="run-title" title={run.topic}>{run.title || run.topic?.slice(0, 40) || run.id}</td>
                    <td class="model-name">{run.model}</td>
                    <td>{fmtTokens(run.tokenUsage?.total_tokens)}</td>
                    <td class="cost">{fmtCost(run.cost)}</td>
                    <td class="run-date">{run.createdAt?.slice(0, 10)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {:else}
      <p>No usage data available.</p>
    {/if}
  </div>
</div>
