<script>
  import { api } from "../lib/api.js";

  export let agentId;

  let insights = null;

  $: if (agentId) loadInsights();

  async function loadInsights() {
    try {
      const data = await api.getAgentInsights(agentId);
      insights = data.insights;
    } catch {
      insights = null;
    }
  }

  function formatSize(bytes) {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  }
</script>

{#if insights}
  <div class="agent-insights">
    <div class="insight-row"><span>Memory Size</span><strong>{formatSize(insights.totalSize)}</strong></div>
    <div class="insight-row"><span>Sections</span><strong>{insights.sectionCount}</strong></div>
    <div class="insight-row"><span>Discussions</span><strong>{insights.sessionCount}</strong></div>
    <div class="insight-row"><span>Topics</span><strong>{(insights.topicKeywords || []).slice(0, 5).join(", ") || "None"}</strong></div>
  </div>
{/if}
