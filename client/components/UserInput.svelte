<script>
  import { sseIsPaused, activeRunId } from "../stores.js";
  import { api } from "../lib/api.js";
  import { addToast } from "../lib/toastManager.js";

  let inputText = "";

  async function submit() {
    if (!inputText.trim()) { addToast("Please enter some input or click Skip.", "error"); return; }
    try {
      await api.submitInput($activeRunId, inputText.trim());
      inputText = "";
    } catch (error) {
      addToast(error.message || "Failed to submit input.", "error");
    }
  }

  async function skip() {
    try {
      await api.submitInput($activeRunId, "(No additional user input)");
    } catch (error) {
      addToast(error.message || "Failed to skip.", "error");
    }
  }
</script>

{#if $sseIsPaused}
  <div class="user-input-area">
    <p class="user-input-prompt">Discussion paused. Provide your input for the next round:</p>
    <textarea bind:value={inputText} rows="4" placeholder="Your guidance, questions, or perspective..."></textarea>
    <div class="form-actions">
      <button type="button" on:click={submit}>Submit & Continue</button>
      <button type="button" on:click={skip}>Skip</button>
    </div>
  </div>
{/if}
