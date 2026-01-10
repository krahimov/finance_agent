# Markets Knowledge Graph (Module 1)

Hybrid knowledge-graph MVP for financial markets:
- **Postgres (Neon)**: versioned facts + provenance (`entities`, `documents`, `document_chunks`, `assertions`, `extraction_runs`, `corrections`)
- **Neo4j**: relationship reasoning + explainable paths (nodes/edges carry `assertionId`, confidence, provenance)
- **Qdrant**: semantic chunk recall (vectors + metadata)
- **Next.js + Vercel AI SDK**: streaming chat with tool-calling and a simple UI

## Setup

1) Install deps:

```bash
pnpm install
```

2) Create `.env.local` from `env.example` and fill in:
- `OPENAI_API_KEY`
- `DATABASE_URL`
- `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`
- `QDRANT_URL` (and optional `QDRANT_API_KEY`)
- `SEC_USER_AGENT` (required by SEC)

3) Create tables:

```bash
pnpm db:push
```

## Run

```bash
pnpm dev
```

## Module 1 write-up (status + submission mapping)

See `docs/module-1-status.md` for a direct mapping of the current implementation to the Module 1 rubric in [AGENTSMYTH ENGINEERING CHALLENGE (1).pdf](file://AGENTSMYTH%20ENGINEERING%20CHALLENGE%20(1).pdf).

## Architecture overview (end-to-end, with diagrams)

See `docs/architecture.md` for a walkthrough of the full architecture (Postgres + Qdrant + Neo4j), including ingestion/extraction flows, hybrid retrieval, and the correction workflow — with Mermaid diagrams.

## Structured signals add-on (EPS estimates + fund inflows)

See `docs/module-1-structured-signals.md` for the design + implementation plan and the new endpoints/tools that support screening prompts like “rising EPS estimates + positive fund inflows”.

### Real EPS estimates via Massive (Benzinga Earnings)

Massive supports API key auth via `Authorization: Bearer YOUR_API_KEY` and hosts at `https://api.massive.com` (see their REST quickstart), and their Benzinga earnings endpoint includes `estimated_eps` and `last_updated` for delta ingestion (see the endpoint docs).

After setting:
- `MASSIVE_API_KEY`
- (optional) `MASSIVE_API_BASE_URL` (defaults to `https://api.massive.com`)

You can ingest EPS estimate snapshots into the `signals` table:

```bash
curl -sS -X POST "http://localhost:3000/api/ingest/massive/benzinga/earnings" \
  -H "content-type: application/json" \
  -H "x-ingestion-secret: $INGESTION_SECRET" \
  -d '{
    "tickers": ["AAPL","MSFT","AMZN","GOOGL","META","NVDA","TSLA"],
    "lastUpdatedGte": "2025-01-01",
    "limit": 5000,
    "includeNextAlias": true
  }'
```

Open:
- `/` for chat
- `/ingestion` to ingest EDGAR filings + run extraction
- `/entities/[id]` for an entity detail view

## Key API routes

- `POST /api/chat`: streaming chat (Vercel AI SDK) with tools:
  - `vectorSearch`, `searchEntities`, `graphTraverse`, `explainPath`, `factsQuery`, `getCitations`
- `GET /api/health`: Postgres/Neo4j/Qdrant connectivity checks
- `POST /api/ingest/edgar`: protected ingestion trigger (uses `x-ingestion-secret`)
- `POST /api/ingest/edgar/bulk`: protected bulk ingestion trigger (uses `x-ingestion-secret`)
- `POST /api/extract/document`: protected extraction + Neo4j projection (uses `x-ingestion-secret`)
- `GET /api/conflicts`: conflict detection (single-valued predicate framework)
- `POST /api/corrections`: retract/supersede workflow (updates Postgres + Neo4j)

## Bulk ingest (recommended for "over time" + CHIPS Act demos)

The bulk endpoint ingests multiple CIKs concurrently and can optionally trigger extraction.

### A) Previous quarters (time series) — Mag 7

Ingest the last ~8 filings per company (mostly recent 10-Qs). Run this twice if you want to ensure you include some 10-Ks too.

```bash
curl -sS -X POST "http://localhost:3000/api/ingest/edgar/bulk" \
  -H "content-type: application/json" \
  -H "x-ingestion-secret: $INGESTION_SECRET" \
  -d '{
    "ciks": ["0000320193","0000789019","0001652044","0001018724","0001045810","0001326801","0001318605"],
    "forms": ["10-Q"],
    "maxFilings": 8,
    "maxChunksPerFiling": 80,
    "concurrency": 2
  }'
```

### B) CHIPS Act universe (filing-based, auditable)

These are common SEC filers that are often directly relevant to CHIPS-related capex / incentives:
Intel, Micron, GlobalFoundries, Applied Materials, Lam Research, KLA.

```bash
curl -sS -X POST "http://localhost:3000/api/ingest/edgar/bulk" \
  -H "content-type: application/json" \
  -H "x-ingestion-secret: $INGESTION_SECRET" \
  -d '{
    "ciks": ["0000050863","0000723125","0001709045","0000006951","0000707549","0000319201"],
    "forms": ["10-K","10-Q"],
    "maxFilings": 10,
    "maxChunksPerFiling": 80,
    "concurrency": 2
  }'
```

### Optional: trigger extraction automatically (costly)

Add `"extract": true` to bulk ingest to run extraction right after ingestion:

```bash
curl -sS -X POST "http://localhost:3000/api/ingest/edgar/bulk" \
  -H "content-type: application/json" \
  -H "x-ingestion-secret: $INGESTION_SECRET" \
  -d '{
    "ciks": ["0000050863","0000723125"],
    "forms": ["10-K","10-Q"],
    "maxFilings": 6,
    "maxChunksPerFiling": 80,
    "concurrency": 2,
    "extract": true,
    "extractDocsPerCik": 1,
    "extractMaxChunks": 40,
    "extractConcurrency": 1
  }'
```

### Get live progress in curl (recommended)

When extraction is enabled, the request can take a while. Add `"stream": true` and use `curl -N` to see progress events as NDJSON:

```bash
curl -N -sS -X POST "http://localhost:3000/api/ingest/edgar/bulk" \
  -H "content-type: application/json" \
  -H "x-ingestion-secret: $INGESTION_SECRET" \
  -d '{
    "ciks": ["0000050863","0000723125"],
    "forms": ["10-K","10-Q"],
    "maxFilings": 6,
    "maxChunksPerFiling": 80,
    "concurrency": 2,
    "extract": true,
    "extractDocsPerCik": 1,
    "extractMaxChunks": 12,
    "extractConcurrency": 1,
    "stream": true
  }'
```
# finance_agent
