<script>
  import { marked } from "marked";
  import { agentCssClass, escapeHtml } from "../lib/utils.js";
  import { api } from "../lib/api.js";
  import { addToast } from "../lib/toastManager.js";

  export let message;
  export let runId;
  export let round;

  let annotations = [];
  let showAnnotationForm = false;
  let annotationText = "";
  let renderTimer;
  let displayedHtml = "";

  $: isStreaming = message._streaming;
  $: cssClass = agentCssClass(message.agentId);

  // Debounced markdown rendering during streaming
  $: {
    if (isStreaming) {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(() => {
        displayedHtml = marked.parse(message.content || "");
      }, 80);
    } else {
      clearTimeout(renderTimer);
      displayedHtml = marked.parse(message.content || "");
    }
  }

  async function saveAnnotation() {
    if (!annotationText.trim()) return;
    try {
      const result = await api.addAnnotation(runId, { round, agentId: message.agentId, text: annotationText.trim() });
      annotations = [...annotations, result.annotation];
      annotationText = "";
      showAnnotationForm = false;
    } catch (error) {
      addToast(error.message || "Failed to save annotation.", "error");
    }
  }

  async function deleteAnnotation(annId) {
    try {
      await api.deleteAnnotation(runId, annId);
      annotations = annotations.filter((a) => a.id !== annId);
    } catch (error) {
      addToast(error.message || "Failed to delete annotation.", "error");
    }
  }

  export function setAnnotations(anns) {
    annotations = anns;
  }
</script>

<article class="msg-card {cssClass}" class:streaming={isStreaming}
  data-round={round} data-agent-id={message.agentId}>
  <header>
    <h4>{message.agentName || message.agentId}</h4>
    <span class="msg-time">
      {#if isStreaming}streaming...{:else}{new Date(message.timestamp).toLocaleTimeString()}{/if}
    </span>
    <button class="annotate-btn" type="button" title="Add annotation"
      on:click={() => showAnnotationForm = !showAnnotationForm}>+Note</button>
  </header>
  <div class="msg-content">{@html displayedHtml}</div>

  {#if showAnnotationForm}
    <div class="annotation-form">
      <textarea bind:value={annotationText} placeholder="Add a note..." rows="2"></textarea>
      <button type="button" on:click={saveAnnotation}>Save</button>
      <button type="button" on:click={() => { showAnnotationForm = false; annotationText = ""; }}>Cancel</button>
    </div>
  {/if}

  <div class="annotations-list">
    {#each annotations as ann (ann.id)}
      <div class="annotation">
        <span class="annotation-text">{ann.text}</span>
        <span class="annotation-time">{new Date(ann.timestamp).toLocaleString()}</span>
        <button class="annotation-delete" title="Delete" on:click={() => deleteAnnotation(ann.id)}>&times;</button>
      </div>
    {/each}
  </div>
</article>
