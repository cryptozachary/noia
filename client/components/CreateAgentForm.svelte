<script>
  import { agents } from "../stores.js";
  import { api } from "../lib/api.js";
  import { addToast } from "../lib/toastManager.js";

  let name = "";
  let purpose = "";
  let identity = "";
  let system = "";
  let model = "";

  async function onSubmit() {
    if (!name.trim() || !system.trim()) {
      addToast("Agent name and system prompt are required.", "error");
      return;
    }
    try {
      await api.createAgent({
        name: name.trim(),
        purpose: purpose.trim(),
        identity,
        system,
        model: model.trim() || undefined
      });
      const data = await api.getAgents();
      $agents = data.agents || [];
      name = ""; purpose = ""; identity = ""; system = ""; model = "";
      addToast("Agent created.");
    } catch (error) {
      addToast(error.message || "Failed to create agent.", "error");
    }
  }
</script>

<h2>Create Agent</h2>
<form on:submit|preventDefault={onSubmit} aria-label="Create custom agent">
  <label>Agent Name</label>
  <input type="text" bind:value={name} placeholder="e.g., Ethics Reviewer" required />
  <label>Purpose</label>
  <input type="text" bind:value={purpose} placeholder="One-line description" />
  <label>Identity</label>
  <textarea rows="3" bind:value={identity} placeholder="# Agent Name&#10;&#10;Role description..."></textarea>
  <label>System Prompt</label>
  <textarea rows="5" bind:value={system} placeholder="You are the... Responsibilities:..." required></textarea>
  <label>Model (optional)</label>
  <input type="text" bind:value={model} placeholder="Default model" />
  <button type="submit">Create Agent</button>
</form>
