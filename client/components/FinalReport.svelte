<script>
  import { marked } from "marked";

  export let report;

  $: html = marked.parse(report || "");
</script>

<article class="final-report" aria-label="Final report">
  {@html html}
</article>
