# NOIA - Scientific Agent Lab

Multi-agent AI discussion platform for scientific research. Three specialized agents (Research Synthesizer, Skeptical Reviewer, Innovation Strategist) debate topics across structured rounds, producing a 10-section synthesis report.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env - set OPENAI_API_KEY (required)

# 3. Start server
npm start

# 4. Open browser
# http://localhost:3000
```

### Development

```bash
npm run dev          # Start backend server
npm run dev:client   # Start Vite dev server (port 5173, proxies /api to 3000)
npm test             # Run all tests (263 tests)
npm run build        # Build frontend for production
```

## Architecture

```
server.js                          Express entry point
src/
  config/index.js                  Environment configuration (31 vars)
  middleware/
    auth.js                        API key authentication (opt-in)
    requestId.js                   X-Request-Id tracing
  routes/api.js                    REST API (30+ endpoints)
  orchestrator/
    discussionOrchestrator.js      Core multi-round discussion logic
    runManager.js                  Active run lifecycle management
  services/
    openaiService.js               OpenAI LLM integration
    anthropicService.js            Anthropic Claude integration
    llmFactory.js                  LLM provider factory
    embeddingService.js            Vector embeddings & similarity search
    researchService.js             Tavily web search integration
    documentService.js             PDF/text document ingestion
    snapshotService.js             Agent state snapshots & rollback
    memoryPruner.js                Agent memory summarization
    costCalculator.js              Token cost tracking (13 models)
    safety.js                      Medical topic detection & disclaimers
    outputValidator.js             Structured output enforcement
    exportBuilder.js               Markdown/HTML report export
    claimExtractor.js              Claim extraction from discussions
    graphBuilder.js                Argument graph construction
  storage/
    index.js                       Storage backend factory
    fileStore.js                   File-based storage (default)
    sqliteStore.js                 SQLite storage (optional)
    bootstrap.js                   Data directory initialization
  agents/
    registry.js                    Agent registry & management
    promptComposer.js              Prompt templates
  utils/
    logger.js                      Structured JSON logging with rotation
    errors.js                      AppError class
client/                            Svelte 5 frontend (19 components)
```

## Features

- **Multi-agent debate** - Parallel agent execution across structured rounds (initial positions, cross-critique, convergence)
- **Streaming output** - Real-time SSE with 20 event types
- **Dual LLM provider** - OpenAI + Anthropic with per-agent model overrides
- **Web research** - Tavily search integration with source tracking
- **Document ingestion** - PDF and text file upload, arXiv paper import
- **Agent memory** - Persistent memory with vector-indexed recall, auto-pruning, and snapshots
- **Interactive mode** - Pause between rounds for user guidance
- **Run management** - Branch from any round, compare runs side-by-side
- **Evaluation** - Claim extraction, argument graph visualization, consensus metrics
- **Export** - Markdown and HTML report export
- **Cost tracking** - Real-time token counting and cost estimation for 16 models
- **Usage dashboard** - Aggregated token/cost analytics by model, day, and run
- **Medical safety** - Automatic keyword detection and disclaimer injection
- **Templates** - Save, reuse, and share discussion configurations with other users
- **Annotations** - Add notes to any agent response
- **Multi-user isolation** - Run ownership, document/template ownership, agent writes admin-only

## Agent Roles

1. **Research Synthesizer** - Maps established background, terminology, current approaches
2. **Skeptical Reviewer** - Stress-tests claims, exposes weak evidence, identifies risk
3. **Innovation Strategist** - Proposes inventive, testable hypotheses and experiments
4. **Coordinator** - Enforces round structure and produces final 10-section synthesis

## Round Flow

Default is 4 rounds (configurable 2-8):

- Round 1: Initial positions
- Round 2: Cross-critique
- Rounds 3..N-1: Convergence
- Round N: Final synthesis by coordinator

## Final Report Structure

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

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check with metrics (uptime, memory, active runs) |
| POST | `/api/discussions` | Create new discussion |
| GET | `/api/discussions/active` | List active run IDs |
| DELETE | `/api/discussions/:runId` | Cancel running discussion |
| GET | `/api/discussions/:runId/stream` | SSE event stream |
| POST | `/api/discussions/:runId/input` | Provide input during pause |
| GET | `/api/runs` | List runs (paginated) |
| GET | `/api/runs/:runId` | Load run with cost |
| DELETE | `/api/runs/:runId` | Delete run |
| GET | `/api/runs/compare?a=X&b=Y` | Compare two runs |
| POST | `/api/runs/:runId/branch` | Branch from round |
| GET | `/api/runs/:runId/export/md` | Export Markdown |
| GET | `/api/runs/:runId/export/html` | Export HTML |
| GET/POST/DELETE | `/api/runs/:runId/annotations` | Annotation CRUD |
| POST | `/api/runs/:runId/evaluate` | Evaluate discussion |
| GET | `/api/agents` | List agents |
| GET/PUT | `/api/agents/:id/memory` | Agent memory |
| POST/GET | `/api/agents/:id/snapshot(s)` | Memory snapshots |
| POST | `/api/agents/:id/prune-memory` | Prune old memory |
| POST | `/api/agents` | Create custom agent |
| GET/POST/DELETE | `/api/templates` | Template CRUD (ownership-scoped) |
| PUT | `/api/templates/:id/share` | Toggle template sharing |
| POST | `/api/documents/upload` | Upload document (10MB) |
| POST | `/api/documents/arxiv` | Import arXiv paper |
| GET/DELETE | `/api/documents/:id` | Document management (ownership-scoped) |
| GET | `/api/cost/estimate` | Cost estimation |
| GET | `/api/usage` | Aggregated usage dashboard data |
| POST/GET/DELETE | `/api/users` | User management (admin) |
| GET | `/api/users/me` | Current user info |

## Configuration

All configuration is via environment variables. See [.env.example](.env.example) for the full list (31 variables).

**Key settings:**

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | *(required)* | OpenAI API key |
| `LLM_PROVIDER` | `openai` | `openai` or `anthropic` |
| `STORAGE_BACKEND` | `file` | `file` or `sqlite` |
| `REQUIRE_AUTH` | `false` | Enable API key authentication |
| `CORS_ORIGIN` | `*` | Comma-separated allowed origins |
| `LOG_DIR` | *(empty)* | Directory for log files (JSON lines, 10MB rotation) |
| `NODE_ENV` | `development` | `production` enables strict security headers |

## Deployment

### Docker

```bash
# Build and run
docker compose up -d

# Or build manually
docker build -t noia .
docker run -p 3000:3000 --env-file .env noia
```

The Docker image uses multi-stage builds, runs as non-root, and includes a health check.

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set `CORS_ORIGIN` to your domain
- [ ] Set `LOG_DIR=/app/logs` for file-based logging
- [ ] Set `REQUIRE_AUTH=true` and create API keys via `POST /api/users`
- [ ] Put behind a reverse proxy (nginx/caddy) with TLS
- [ ] Back up `data/` directory or SQLite database

## Security

- **Helmet** - Security headers (CSP in production, X-Content-Type-Options, HSTS)
- **CORS** - Configurable origin whitelist
- **Rate limiting** - 120 req/min API, 10 req/min discussion creation, SSE exempt
- **Authentication** - Opt-in API key auth via `X-API-Key` header with SHA-256 hashed storage
- **User isolation** - Runs, documents, and templates scoped to their owner; active discussions owner-checked
- **Admin controls** - Agent memory/config writes, agent creation/deletion require admin when auth enabled
- **Request tracing** - `X-Request-Id` on all requests and error responses
- **Path traversal protection** - All path parameters validated
- **Input validation** - Request schema validation, file size limits (10MB)
- **Error containment** - Stack traces stripped in production
- **Write locking** - File store serializes concurrent writes per resource

## Storage Backends

**File (default):** JSON files in `data/` directory. Write-through locking prevents race conditions. Good for development and small deployments.

**SQLite:** Set `STORAGE_BACKEND=sqlite`. WAL mode enabled. Better for concurrent access and 1000+ runs. Migrate existing data:

```bash
node scripts/migrate-to-sqlite.js
```

## Testing

```bash
npm test              # All 263 tests (unit + integration)
```

22 unit test suites covering all services, storage backends, authentication, ownership, and orchestration. 26 integration tests covering HTTP endpoints, security headers, request tracing, and CRUD operations.

## License

MIT
