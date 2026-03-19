<script>
  import { onMount } from "svelte";

  export let graph;

  let canvas;
  let tooltipText = "";
  let tooltipX = 0;
  let tooltipY = 0;
  let showTooltip = false;
  let simNodes = [];

  onMount(() => {
    if (canvas && graph) renderGraph();
  });

  $: if (canvas && graph) renderGraph();

  function renderGraph() {
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    const nodes = (graph.nodes || []).slice(0, 50);
    const edges = graph.edges || [];
    if (nodes.length === 0) { ctx.clearRect(0, 0, W, H); return; }

    // Assign colors by agent
    const agentColors = {};
    const palette = ["#1f7a5a", "#97410e", "#425bb3", "#585068", "#6b7280", "#0e5a7a", "#8b5cf6", "#d97706"];
    let ci = 0;
    for (const n of nodes) {
      if (!agentColors[n.agentId]) agentColors[n.agentId] = palette[ci++ % palette.length];
    }

    // Initialize positions randomly
    const sim = nodes.map((n) => ({
      ...n,
      x: W * 0.2 + Math.random() * W * 0.6,
      y: H * 0.2 + Math.random() * H * 0.6,
      vx: 0, vy: 0
    }));
    const idMap = {};
    sim.forEach((n, i) => { idMap[n.id] = i; });

    // Force simulation
    const ITERATIONS = 120;
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const alpha = 1 - iter / ITERATIONS;
      for (let i = 0; i < sim.length; i++) {
        for (let j = i + 1; j < sim.length; j++) {
          let dx = sim[j].x - sim[i].x;
          let dy = sim[j].y - sim[i].y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (800 * alpha) / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          sim[i].vx -= fx; sim[i].vy -= fy;
          sim[j].vx += fx; sim[j].vy += fy;
        }
      }
      for (const edge of edges) {
        const si = idMap[edge.source];
        const ti = idMap[edge.target];
        if (si === undefined || ti === undefined) continue;
        let dx = sim[ti].x - sim[si].x;
        let dy = sim[ti].y - sim[si].y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 80) * 0.02 * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        sim[si].vx += fx; sim[si].vy += fy;
        sim[ti].vx -= fx; sim[ti].vy -= fy;
      }
      for (const n of sim) {
        n.vx += (W / 2 - n.x) * 0.005 * alpha;
        n.vy += (H / 2 - n.y) * 0.005 * alpha;
      }
      for (const n of sim) {
        n.vx *= 0.6; n.vy *= 0.6;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(20, Math.min(W - 20, n.x));
        n.y = Math.max(20, Math.min(H - 20, n.y));
      }
    }

    // Draw
    ctx.clearRect(0, 0, W, H);

    const edgeColors = { supports: "#22c55e", contradicts: "#ef4444", extends: "#3b82f6" };
    for (const edge of edges) {
      const si = idMap[edge.source];
      const ti = idMap[edge.target];
      if (si === undefined || ti === undefined) continue;
      ctx.beginPath();
      ctx.moveTo(sim[si].x, sim[si].y);
      ctx.lineTo(sim[ti].x, sim[ti].y);
      ctx.strokeStyle = edgeColors[edge.type] || "#999";
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const confRadius = { high: 10, medium: 7, low: 5 };
    for (const n of sim) {
      const r = confRadius[n.confidence] || 7;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = agentColors[n.agentId] || "#6b7280";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Legend
    ctx.font = "11px sans-serif";
    let lx = 10, ly = H - 10;
    for (const [type, color] of Object.entries(edgeColors)) {
      ctx.beginPath(); ctx.moveTo(lx, ly - 4); ctx.lineTo(lx + 18, ly - 4);
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#333"; ctx.fillText(type, lx + 22, ly);
      lx += ctx.measureText(type).width + 36;
    }

    simNodes = sim;
  }

  function onMouseMove(e) {
    if (!simNodes.length) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    let hit = null;
    for (const n of simNodes) {
      const dx = mx - n.x, dy = my - n.y;
      if (dx * dx + dy * dy < 144) { hit = n; break; }
    }
    if (hit) {
      tooltipText = `[${hit.type}] ${hit.text}`;
      tooltipX = e.clientX - canvas.parentElement.getBoundingClientRect().left + 12;
      tooltipY = e.clientY - canvas.parentElement.getBoundingClientRect().top - 20;
      showTooltip = true;
    } else {
      showTooltip = false;
    }
  }
</script>

<div class="graph-container">
  <canvas bind:this={canvas} width="800" height="500"
    on:mousemove={onMouseMove} on:mouseleave={() => showTooltip = false}></canvas>
  {#if showTooltip}
    <div class="graph-tooltip" style="left:{tooltipX}px;top:{tooltipY}px">{tooltipText}</div>
  {/if}
</div>
