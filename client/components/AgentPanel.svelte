<script>
  import { agents, selectedAgentId, statusText } from "../stores.js";
  import { api } from "../lib/api.js";
  import { addToast } from "../lib/toastManager.js";
  import AgentInsights from "./AgentInsights.svelte";
  import CreateAgentForm from "./CreateAgentForm.svelte";

  let memoryText = "";
  let modelOverride = "";

  $: selectedAgent = $agents.find((a) => a.id === $selectedAgentId);
  $: if ($agents.length && !$selectedAgentId) {
    $selectedAgentId = $agents[0].id;
  }

  async function onAgentChange() {
    const agent = $agents.find((a) => a.id === $selectedAgentId);
    memoryText = agent ? agent.memory || "" : "";
    try {
      const data = await api.getAgentConfig($selectedAgentId);
      modelOverride = (data.agent?.config?.model) || "";
    } catch {
      modelOverride = "";
    }
  }

  // Trigger on agent change
  $: if ($selectedAgentId) onAgentChange();

  async function saveMemory() {
    if (!$selectedAgentId) return;
    $statusText = "Saving Memory";
    try {
      await api.saveAgentMemory($selectedAgentId, memoryText);
      agents.update((list) => list.map((a) =>
        a.id === $selectedAgentId ? { ...a, memory: memoryText } : a
      ));
      addToast("Memory saved.");
    } catch (error) {
      addToast(error.message || "Memory update failed.", "error");
    } finally {
      $statusText = "Idle";
    }
  }

  async function saveConfig() {
    if (!$selectedAgentId) return;
    try {
      await api.saveAgentConfig($selectedAgentId, modelOverride.trim());
      addToast("Agent model saved.");
    } catch (error) {
      addToast(error.message || "Config update failed.", "error");
    }
  }
</script>

<h2>Agent Memory</h2>
<label>Agent</label>
<select bind:value={$selectedAgentId}>
  {#each $agents as agent (agent.id)}
    <option value={agent.id}>{agent.name}</option>
  {/each}
</select>
<textarea rows="12" bind:value={memoryText}></textarea>
<button class="btn-primary" on:click={saveMemory}>Save Memory</button>

{#if $selectedAgentId}
  <AgentInsights agentId={$selectedAgentId} />
{/if}

<label>Model Override (blank = default)</label>
<input type="text" bind:value={modelOverride} placeholder="e.g., gpt-4.1-mini" />
<button class="btn-primary" on:click={saveConfig}>Save Model</button>

<hr />

<CreateAgentForm />
