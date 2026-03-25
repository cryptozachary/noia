<script>
  import { statusText } from "../stores.js";
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher();
</script>

<a href="#newDiscussionForm" class="skip-link">Skip to main content</a>
<header class="topbar" role="banner">
  <div>
    <h1>Scientific Agent Lab</h1>
    <p class="subtitle">Persistent multi-agent scientific debate and synthesis</p>
  </div>
  <div class="topbar-actions">
    <button class="usage-btn" on:click={() => dispatch("toggle-usage")} title="Usage Dashboard">Usage</button>
    <div class="badge" role="status" aria-live="polite">{$statusText}</div>
  </div>
</header>
