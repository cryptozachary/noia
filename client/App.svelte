<script>
  import { onMount } from "svelte";
  import { api } from "./lib/api.js";
  import { connectSSE } from "./lib/sse.js";
  import { agents, historyRuns, templates, activeRunId, statusText } from "./stores.js";

  import TopBar from "./components/TopBar.svelte";
  import Toast from "./components/Toast.svelte";
  import DiscussionForm from "./components/DiscussionForm.svelte";
  import DiscussionRun from "./components/DiscussionRun.svelte";
  import HistoryList from "./components/HistoryList.svelte";
  import AgentPanel from "./components/AgentPanel.svelte";
  import RunComparison from "./components/RunComparison.svelte";
  import UsageDashboard from "./components/UsageDashboard.svelte";

  let showUsage = false;

  onMount(async () => {
    $statusText = "Loading";
    try {
      const [runsData, agentsData, templatesData] = await Promise.all([
        api.getRuns(),
        api.getAgents(),
        api.getTemplates()
      ]);
      $historyRuns = runsData.runs || [];
      $agents = agentsData.agents || [];
      $templates = templatesData.templates || [];
    } catch {
      // Initial load failed — app still usable
    }

    // Reconnect to active run if page was refreshed
    try {
      const active = await api.getActiveRuns();
      if (active.activeRunIds?.length > 0) {
        $activeRunId = active.activeRunIds[0];
        connectSSE($activeRunId);
      }
    } catch {
      // No active runs
    }

    $statusText = "Idle";
  });
</script>

<TopBar on:toggle-usage={() => showUsage = !showUsage} />
<Toast />

<main class="layout" role="main">
  <section class="panel control-panel" aria-label="Discussion controls">
    <DiscussionForm />
  </section>

  <section class="panel run-panel" aria-label="Discussion output">
    <DiscussionRun />
  </section>

  <section class="panel side-panel" aria-label="History and agent settings">
    <HistoryList />
    <hr />
    <AgentPanel />
  </section>
</main>

<RunComparison />

{#if showUsage}
  <UsageDashboard onClose={() => showUsage = false} />
{/if}
