# Scientific Agent Lab

Scientific Agent Lab is a local-first MVP for structured multi-agent scientific discussion.
It runs three persistent scientist agents plus one coordinator agent, stores transcripts on disk, and produces a structured synthesis report.

## What It Does

- Runs configurable round-based scientific discussions on user topics.
- Maintains separate identity, system prompt, memory, and session transcripts per agent.
- Persists all run artifacts locally in the filesystem.
- Enforces structured output and uncertainty labeling.
- Adds explicit safety disclaimer behavior for medical/health topics.
- Supports history browsing, run reload, and in-app memory editing.

## Stack

- Node.js
- Express
- OpenAI API (`openai` package)
- Vanilla HTML/CSS/JavaScript
- Filesystem persistence (no DB in v1)

## Project Structure

```text
.
+- server.js
+- package.json
+- .env.example
+- public/
¦  +- index.html
¦  +- styles.css
¦  +- app.js
+- src/
¦  +- config/
¦  ¦  +- index.js
¦  +- routes/
¦  ¦  +- api.js
¦  +- orchestrator/
¦  ¦  +- discussionOrchestrator.js
¦  +- agents/
¦  ¦  +- registry.js
¦  ¦  +- promptComposer.js
¦  +- services/
¦  ¦  +- openaiService.js
¦  ¦  +- outputValidator.js
¦  ¦  +- safety.js
¦  +- storage/
¦  ¦  +- bootstrap.js
¦  ¦  +- fileStore.js
¦  +- utils/
¦     +- errors.js
¦     +- logger.js
+- data/
¦  +- agents/
¦  ¦  +- research-synthesizer/
¦  ¦  +- skeptical-reviewer/
¦  ¦  +- innovation-strategist/
¦  ¦  +- coordinator/
¦  +- topics/
¦  +- runs/
¦  +- exports/
+- scripts/
   +- seed-sample-runs.js
   +- verify-mvp.js
```

## Agent Roles

1. Research Synthesizer
- Maps known background and scientific framing.

2. Skeptical Reviewer
- Challenges assumptions and evidence quality.

3. Innovation Strategist
- Proposes novel but testable research directions.

4. Coordinator
- Orchestrates rounds and produces final synthesis.

## Round Flow

Default is 4 rounds (configurable 2-8):

- Round 1: Initial positions
- Round 2: Cross-critique
- Round 3..N-1: Convergence
- Round N: Final synthesis by coordinator

## Final Report Structure

The coordinator final report is normalized to include exactly:

1. Topic
2. Executive Summary
3. Known / Established Points
4. Most Promising Hypotheses
5. Major Objections / Risks
6. Proposed Experiments or Validation Steps
7. Unresolved Disagreements
8. Confidence / Uncertainty Summary
9. Suggested Next Research Directions
10. Safety Note / Disclaimer

## API Overview

- `GET /api/health`
- `GET /api/runs`
- `GET /api/runs/:runId`
- `POST /api/discussions`
- `GET /api/agents`
- `GET /api/agents/:agentId/memory`
- `PUT /api/agents/:agentId/memory`
- `GET /api/agents/:agentId/config`

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create environment file:
```bash
copy .env.example .env
```

3. Add your OpenAI key in `.env`:
- `OPENAI_API_KEY=...`

4. Seed sample runs:
```bash
npm run seed
```

5. Run verification script:
```bash
npm run verify
```

6. Start server:
```bash
npm start
```

Open: `http://localhost:3000`

## Notes On Prompt / Code Sync

- Agent prompt files are externalized in `data/agents/*/system.md`.
- Orchestrator enforces structure independently and normalizes missing sections.
- Memory editor writes directly to each agent `memory.md` file.
- Keep prompt headings aligned with `src/services/outputValidator.js` when editing structure.

## Known MVP Limitations

- Runs are synchronous and request/response based (no background queue yet).
- No live token usage telemetry.
- No citation retrieval tooling in this version.
- UI assumes local trusted environment (no auth layer in v1).

## Next Improvements

- Add consensus/debate mode switches.
- Add per-agent model settings.
- Add transcript compaction and memory summarization.
- Add citation mode and optional tool-enabled research connectors.
- Add robust integration tests and run replay harness.
