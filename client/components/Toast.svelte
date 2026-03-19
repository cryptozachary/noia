<script>
  import { toasts } from "../stores.js";
  import { fly } from "svelte/transition";
</script>

<div class="toast-container" aria-live="assertive" aria-atomic="true">
  {#each $toasts as toast (toast.id)}
    <div class="toast toast-{toast.type} show" role="alert" transition:fly={{ y: 12, duration: 250 }}>
      {toast.message}
    </div>
  {/each}
</div>
