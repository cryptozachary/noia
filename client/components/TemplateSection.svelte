<script>
  import { createEventDispatcher } from "svelte";
  import { templates } from "../stores.js";
  import { api } from "../lib/api.js";
  import { addToast } from "../lib/toastManager.js";

  export let topic = "";
  export let rounds = 4;
  export let stagesRaw = "";
  export let autoMemory = true;
  export let webSearch = false;
  export let interactive = false;

  const dispatch = createEventDispatcher();

  let selectedId = "";
  $: showDelete = selectedId !== "";

  async function onSave() {
    const name = prompt("Template name:");
    if (!name || !name.trim()) return;
    let stages = null;
    if (stagesRaw.trim()) {
      try { stages = JSON.parse(stagesRaw); } catch { /* ignore */ }
    }
    try {
      await api.saveTemplate({
        name: name.trim(), topic, rounds, stages,
        settings: { autoMemory, webSearch, interactive }
      });
      addToast("Template saved.");
      await refreshTemplates();
    } catch (error) {
      addToast(error.message || "Failed to save template.", "error");
    }
  }

  function onChange() {
    if (!selectedId) return;
    const tmpl = $templates.find((t) => t.id === selectedId);
    if (tmpl) dispatch("select", tmpl);
  }

  async function onDelete() {
    if (!selectedId) return;
    const tmpl = $templates.find((t) => t.id === selectedId);
    if (!confirm(`Delete template "${tmpl ? tmpl.name : selectedId}"?`)) return;
    try {
      await api.deleteTemplate(selectedId);
      addToast("Template deleted.");
      selectedId = "";
      await refreshTemplates();
    } catch (error) {
      addToast(error.message || "Failed to delete template.", "error");
    }
  }

  async function refreshTemplates() {
    try {
      const data = await api.getTemplates();
      $templates = data.templates || [];
    } catch { /* ignore */ }
  }
</script>

<div class="template-section">
  <div class="template-header">
    <label>Templates</label>
    <button type="button" class="save-template-btn" on:click={onSave}>Save as Template</button>
  </div>
  <select bind:value={selectedId} on:change={onChange}>
    <option value="">-- Load Template --</option>
    {#each $templates as tmpl (tmpl.id)}
      <option value={tmpl.id}>{tmpl.name}</option>
    {/each}
  </select>
  {#if showDelete}
    <button type="button" class="delete-template-btn" on:click={onDelete}>Delete</button>
  {/if}
</div>
