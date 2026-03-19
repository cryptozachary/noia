<script>
  import MetricsDisplay from "./MetricsDisplay.svelte";
  import ArgumentGraph from "./ArgumentGraph.svelte";

  export let metrics;
  export let graph = null;
</script>

<section class="evaluation-panel">
  <h3>Discussion Evaluation</h3>
  <MetricsDisplay {metrics} />
  {#if graph}
    <ArgumentGraph {graph} />
  {/if}
</section>
