<script>
  export let sources = [];
</script>

{#if sources.length > 0}
  <details class="research-sources">
    <summary>Research Sources ({sources.length})</summary>
    <ol class="source-list">
      {#each sources as source, i}
        <li>
          <strong>{source.title || `Source ${i + 1}`}</strong>
          {#if source.url}
            <a href={source.url} target="_blank" rel="noopener noreferrer" class="source-url">{source.url}</a>
          {/if}
          {#if source.snippet}
            <p class="source-snippet">{source.snippet}</p>
          {/if}
        </li>
      {/each}
    </ol>
  </details>
{/if}
