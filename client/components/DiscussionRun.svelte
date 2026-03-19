<script>
  import { currentRun, activeRunId, sseRounds, sseFinalReport, liveTokens, currentModel } from "../stores.js";
  import { clientCalculateCost, formatCost } from "../lib/costs.js";
  import { escapeHtml } from "../lib/utils.js";
  import { api } from "../lib/api.js";
  import { addToast } from "../lib/toastManager.js";
  import RoundCard from "./RoundCard.svelte";
  import UserInput from "./UserInput.svelte";
  import FinalReport from "./FinalReport.svelte";
  import EvaluationPanel from "./EvaluationPanel.svelte";

  $: run = $currentRun;
  $: rounds = run?.roundMessages || ($activeRunId ? $sseRounds : []);
  $: finalText = run?.finalReport || $sseFinalReport;
  $: tokenUsage = run?.metadata?.tokenUsage || $liveTokens;
  $: model = run?.metadata?.model || $currentModel;
  $: cost = clientCalculateCost(model, tokenUsage);
  $: hasTokens = tokenUsage.total_tokens > 0;
  $: runId = run?.id || $activeRunId;
  $: evalMetrics = run?.metadata?.evaluationMetrics;
  $: evalGraph = run?.metadata?.argumentGraph;
  $: hasReport = Boolean(finalText);

  async function copyReport() {
    if (!finalText) return;
    await navigator.clipboard.writeText(finalText);
    addToast("Final report copied.");
  }

  function exportMd() {
    if (!run?.id) return;
    window.open(api.exportMdUrl(run.id), "_blank");
  }

  function exportHtml() {
    if (!run?.id) return;
    window.open(api.exportHtmlUrl(run.id), "_blank");
  }
</script>

<div class="panel-header-row">
  <h2>Discussion Run</h2>
  <div class="actions">
    <button disabled={!hasReport} on:click={copyReport}>Copy Final Report</button>
    <button disabled={!hasReport} on:click={exportMd}>Export .md</button>
    <button disabled={!hasReport} on:click={exportHtml}>Export .html</button>
  </div>
</div>

{#if run}
  <div class="run-meta">
    <strong>{run.title || run.topic}</strong><br />
    <span>{run.id}</span><br />
    <span>Rounds: {run.rounds || 0} | Status: {run.metadata ? run.metadata.status : "unknown"}</span>
  </div>
{:else if $activeRunId}
  <div class="run-meta">
    <strong>Running...</strong><br />
    <span>{$activeRunId}</span>
  </div>
{:else}
  <div class="run-meta empty">Start or load a session to view discussion rounds.</div>
{/if}

{#if hasTokens}
  <div class="token-summary">
    Tokens: <strong>{tokenUsage.total_tokens.toLocaleString()}</strong> total
    ({tokenUsage.input_tokens.toLocaleString()} in / {tokenUsage.output_tokens.toLocaleString()} out)
    {#if cost > 0}
      <span> | Cost: {formatCost(cost)}</span>
    {/if}
  </div>
{/if}

<div class="rounds" aria-label="Discussion rounds">
  {#each rounds as round (round.round)}
    <RoundCard {round} {runId} />
  {/each}
</div>

<UserInput />

{#if finalText}
  <FinalReport report={finalText} />
{/if}

{#if evalMetrics}
  <EvaluationPanel metrics={evalMetrics} graph={evalGraph} />
{/if}
