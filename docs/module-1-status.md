# Module 1 — Where we stand (Markets Knowledge Graph Construction & Inference)

This document maps the **current codebase** to the expectations in **Module 1** of the assignment: [AGENTSMYTH ENGINEERING CHALLENGE (1).pdf](file://AGENTSMYTH%20ENGINEERING%20CHALLENGE%20(1).pdf).

## 0) TL;DR scorecard

- **Section 1 (Schema design & concept modeling)**: **Mostly implemented (core), needs stronger presentation + a few missing relationship categories**
  - Implemented: canonical entity table, document/chunk modeling, assertion model, provenance + versioning fields
  - Missing: broader market schema coverage (ownership, flows, macro calendar), richer relationship vocabulary, explicit diagram in repo (now included below)
- **Section 2 (Construction, updates, change management)**: **Implemented (MVP+)**
  - Implemented: incremental EDGAR ingestion, chunking, embeddings → Qdrant, extraction runs → Postgres assertions, projection to Neo4j, corrections + conflict detection baseline
  - Missing: better entity resolution/dedup, backfills/scheduling, “update if changed” re-ingestion strategy
- **Section 3 (Query patterns & retrieval strategies)**: **Implemented (MVP), needs explicit hybrid patterns + scoring/reranking**
  - Implemented: tool-callable vector search, entity search, graph traversal, fact queries, citations
  - Missing: explicit hybrid pipeline (retrieve→expand→rerank), edge weighting, guardrails (depth caps per query type), evaluation harness

---

## 1) Section 1 — Schema Design & Concept Modeling

### 1.1 Implemented core entities (relational “truth layer”)

In Postgres/Drizzle (`src/lib/db/schema.ts`) we currently model:

- **Entity** (`entities`)
  - `type`: `company | instrument | sector | country | event | concept | indicator`
  - `canonicalName`, `aliases`, `identifiers` (JSONB)
- **Document** (`documents`)
  - `source` (currently `"sec_edgar"`), `docType` (`10-k|10-q`), `cik`, `accessionNo`, `filingDate`, `url`, `hash`
- **DocumentChunk** (`document_chunks`)
  - chunk text + offsets + `qdrantPointId`
- **Assertion / Fact** (`assertions`)
  - `(subjectEntityId, predicate, objectEntityId|literalValue)`
  - **Provenance**: `sourceDocumentId`, `sourceChunkId`, `extractionRunId`
  - **Versioning**: `validFrom`, `validTo`, `status` (`active|retracted|superseded`)
- **ExtractionRun** (`extraction_runs`): model/prompt version + params + timestamps
- **Correction** (`corrections`): retract/supersede/override applied to assertions
- **SourceReliability** (`source_reliability`): base weighting hook (not yet used in scoring)

This matches the assignment’s emphasis on **versioning, provenance, and auditability**.

### 1.2 Implemented core graph schema (reasoning layer)

In Neo4j projection (`src/lib/neo4j/project.ts`) we create:

- **Nodes**
  - `(:Entity)` with typed labels (`:Company`, `:Concept`, etc.)
  - `(:Filing)` keyed by `documentId`
  - `(:Chunk)` keyed by `chunkId`
- **Edges**
  - `(:Filing)-[:HAS_CHUNK]->(:Chunk)`
  - `(:Chunk)-[:MENTIONS]->(:Entity)` with provenance fields
  - `(:Entity)-[:BENEFITS_FROM|EXPOSED_TO|SUPPLIES_TO|IMPACTS]->(:Entity)` with `assertionId`, confidence, provenance, `validFrom/validTo/status`

This already enables **cross-company reasoning paths** (“show the path + cite evidence”).

### 1.3 Vector schema (recall layer)

In Qdrant (`src/lib/edgar/ingest.ts` and `src/lib/qdrant/collections.ts`):

- Collection: `doc_chunks`
- Each point represents a **document chunk** and stores payload fields:
  - `chunk_id`, `document_id`, `cik`, `accession_no`, `doc_type`, `filing_date`, `chunk_index`
- Payload indexes are ensured to support filterable search.

### 1.4 Technology choice justification (hybrid)

Current architecture is the exact “hybrid” pattern the prompt expects:

- **Postgres**: canonical facts, versioning, provenance, corrections
- **Neo4j**: relationship traversal + explainable paths
- **Qdrant**: semantic recall over filings (chunks)

Tradeoff acknowledged: we currently keep **assertions canonical in Postgres** and project a working subgraph to Neo4j for traversal.

### 1.5 Diagram (current system)

```mermaid
flowchart LR
  subgraph Sources
    EDGAR[SEC EDGAR 10-K/10-Q]
  end

  subgraph Ingestion
    Fetch[Fetch filing HTML]
    Normalize[Strip HTML -> text]
    Chunk[Chunk text]
    Embed[Embed chunks]
  end

  subgraph Storage
    PG[(Postgres/Neon)]
    QD[(Qdrant)]
    N4J[(Neo4j)]
  end

  subgraph Extraction
    LLM[LLM extraction (entities+relations)]
    Project[Project to Neo4j]
  end

  subgraph Retrieval
    Tools[Tool API: vectorSearch / factsQuery / graphTraverse / explainPath / getCitations]
    Chat[Next.js + Vercel AI SDK chat]
  end

  EDGAR --> Fetch --> Normalize --> Chunk --> Embed --> QD
  Chunk --> PG
  Normalize --> PG
  PG --> LLM --> PG
  PG --> Project --> N4J
  QD --> Tools
  PG --> Tools
  N4J --> Tools
  Tools --> Chat
```

### 1.6 What’s missing vs the “full markets schema”

The assignment expects schema connections across:
- fundamentals / ownership / flows
- macro calendars
- news / transcripts

We have the **extensible foundation**, but those domain entities/edges are not ingested yet. The key gap is **breadth of entity/relationship types**, not the architecture.

---

## 2) Section 2 — Graph Construction, Updates, Change Management

### 2.1 Construction pipeline (implemented)

- **Incremental ingestion** (EDGAR): `src/lib/edgar/ingest.ts`
  - Fetch submission → choose latest N filings → skip if already ingested
  - Normalize + chunk + embed → write `documents`, `document_chunks`
  - Upsert chunk vectors to Qdrant
- **Extraction + projection**: `src/lib/extraction/run.ts`
  - For each chunk: extract entities/relations → upsert entities + insert assertions
  - Project to Neo4j: `Entity` nodes, `MENTIONS`, and assertion edges

### 2.2 Versioning & provenance (implemented)

Implemented in Postgres assertions:
- `validFrom/validTo`
- `status` (`active/retracted/superseded`)
- `sourceDocumentId`, `sourceChunkId`, `extractionRunId`

And projected to Neo4j edges with the same metadata.

### 2.3 Error correction workflow (implemented)

`src/lib/corrections/apply.ts`:
- **Retract**: set assertion status `retracted`, set `validTo`, record correction, close Neo4j edge(s)
- **Supersede/Override**: supersede old assertion + create new active assertion, project new edge, close old edge

This is exactly what the prompt wants: **corrections as new versions**, not overwrite.

### 2.4 Conflict detection (baseline implemented)

`src/lib/conflicts/detect.ts`:
- Implements a “single-valued predicate” conflict detector (e.g., CEO).
- Returns groups where a subject has >1 distinct object value among active assertions.

### 2.5 What’s missing / next steps for Section 2

- **Entity resolution**: today we dedupe only on `(type, canonicalName)` exact match; needs alias/ticker/CIK normalization + fuzzy matching.
- **Re-ingestion updates**: we skip existing filings without checking if content changed (hash is stored but not used for update decisions).
- **Source weighting**: `source_reliability` exists but isn’t used in scoring or conflict resolution.
- **Automation**: ingestion/extraction are currently manual-triggered; add scheduling/backfills once MVP is stable.

---

## 3) Section 3 — Query Patterns, Retrieval Strategies & Precision/Recall

### 3.1 Implemented tool surface (MVP)

The chat agent has tool-call access to:
- **vectorSearch** (Qdrant): semantic chunk recall
- **getCitations** (Postgres): evidence for chunk IDs / assertion IDs
- **searchEntities** (Postgres): resolve entity IDs for graph
- **graphTraverse / explainPath** (Neo4j): neighborhood + connection paths
- **factsQuery** (Postgres): precise, versioned assertions
- **listDocuments** (Postgres): discover available filings / accession numbers

This is already a usable hybrid interface: “retrieve evidence” + “reason over a graph” + “audit facts”.

### 3.2 Example hybrid query patterns (how the agent should behave)

**Pattern A: Concept question → evidence-first**
1) vectorSearch(query, filters={cik?})
2) getCitations(chunkIds)
3) optionally: extract named entities from citations → searchEntities → graphTraverse for expansion

**Pattern B: Cross-company connection**
1) searchEntities("Apple"), searchEntities("NVIDIA")
2) explainPath(fromEntityId, toEntityId)
3) getCitations(assertionIds from edges if available; otherwise follow up with vectorSearch over topic)

**Pattern C: High precision fact check**
1) searchEntities("Apple")
2) factsQuery(subjectEntityId=..., predicate=...)
3) getCitations(assertionIds)

### 3.3 What’s missing / next steps for Section 3

- **Explicit scoring/reranking**: today we rely on LLM reasoning + raw vector similarity; next add:
  - source reliability weights
  - confidence thresholds
  - graph-distance penalties, depth caps, and edge-type priors
- **Query expansion**: use `MENTIONS` edges to constrain vector search (e.g., “only chunks that mention the entities in the path”).
- **Evaluation harness**: a small suite of gold queries with expected citations/paths to measure precision/recall regressions.

---

## 4) What to say in the submission (honest + strong)

If submitting today, the best framing is:

- We implemented a **hybrid Markets KG**: Postgres for canonical, versioned assertions + provenance; Neo4j for relationship reasoning; Qdrant for semantic recall over filings.
- We implemented **incremental ingestion** (EDGAR) and **LLM extraction** with schema enforcement and normalization.
- We support **corrections** as first-class operations (retract/supersede), updating both truth store and graph projection.
- We expose **hybrid retrieval** through tool-calling: vector recall + graph traversal + fact queries with citations.
- Remaining work is schema breadth (more entity/edge types + structured sources), entity resolution, and scoring/reranking/evaluation.


