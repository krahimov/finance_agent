# Module 1 Add-on — Structured Signals (EPS Estimates + Fund Inflows)

This document describes the **design + implementation plan** for supporting prompts like:

> “Find signals related to companies with both rising EPS estimates and positive fund inflows.”

That query cannot be answered reliably from SEC filings alone; it requires **structured market datasets** (estimates + flows).

---

## 1) What exists today (implemented in this repo)

### 1.1 Storage (Postgres / Neon)

We added a `signals` table (Drizzle: `src/lib/db/schema.ts`) to store time-series observations with provenance:

- **Identity**
  - `cik` (normalized; joins easily to filings)
  - `subjectEntityId` (optional link to `entities` when available)
- **Signal**
  - `signalKey` (string key, e.g. `eps_ntm_consensus`, `fund_flow_4w_usd`)
  - `asOfDate` (YYYY-MM-DD)
  - `value` + optional `unit`
- **Provenance**
  - `source`, `sourceRef`, `sourceUrl`, `confidence`, `raw`

This keeps the Module 1 “truth layer” properties: provenance + auditability.

### 1.2 Ingestion (API)

Protected endpoint:

- `POST /api/ingest/signals`
- Header: `x-ingestion-secret: $INGESTION_SECRET`

Payload shape:

```json
{
  "rows": [
    {
      "cik": "0000320193",
      "signalKey": "eps_ntm_consensus",
      "asOfDate": "2025-12-20",
      "value": 7.12,
      "unit": "USD",
      "source": "manual",
      "sourceRef": "demo-upload-2025-12-24",
      "sourceUrl": "https://example.com/dataset",
      "confidence": 0.9,
      "raw": { "ticker": "AAPL" }
    }
  ]
}
```

### 1.3 Retrieval / screening (tool-callable)

Chat tool:

- `screenSignals`

It screens for companies where:
- EPS series is **rising** over a lookback window (latest − earliest > threshold)
- flows are **positive** over a lookback window (sum > threshold)

Defaults:
- `epsKey`: `eps_est_next`, window: 90d
- `flowKey`: `fund_flow_4w_usd`, window: 28d

### 1.4 Real EPS estimates ingestion (Massive → Benzinga Earnings)

If you have a Massive API key, you can ingest real earnings EPS estimates via:

- `POST /api/ingest/massive/benzinga/earnings`
- Requires `MASSIVE_API_KEY` and (optional) `MASSIVE_API_BASE_URL` in env.

This ingests:
- `eps_est_next` (alias for the next upcoming earnings event per ticker)
- `eps_est_<fiscal_period>_<fiscal_year>` (e.g. `eps_est_q1_2026`)

Source doc: `https://massive.com/docs/rest/partners/benzinga/earnings`

---

## 2) How this fits Module 1 (mapping to rubric)

### Section 1 — Schema / concept modeling

- We model **Indicators** and **time series** as first-class, queryable data.
- We keep the core hybrid pattern:
  - Postgres: canonical time-series truth + provenance
  - Qdrant: semantic recall from filings (unstructured)
  - Neo4j: relationships / reasoning paths

### Section 2 — Updates + change management

- Signals are ingested as **append/update** per `(cik, signalKey, asOfDate, source)` with provenance.
- Newer values do not destroy history; they create a new as-of point.
- Providers can be tracked via `source/sourceRef`.

### Section 3 — Query patterns (precision + recall)

Best-practice hybrid pattern for the target prompt:

1) **Symbolic screen** (precision): `screenSignals` returns candidate companies from structured datasets.
2) **Explain with evidence** (recall + narrative): for each company, run `timelineSearch`/`vectorSearch` on filings for “guidance”, “demand”, “capex”, etc., then `getCitations`.
3) **Optional graph expansion**: traverse Neo4j around key entities mentioned in the passages to propose causal hypotheses (with citations).

---

## 3) Implementation plan (next steps to make it “production-like”)

### 3.1 Data sources (choose one)

- **Provider API**: FactSet / LSEG / Bloomberg / Koyfin / etc.
  - Pro: authoritative, consistent
  - Con: credentials + cost + licensing
- **CSV uploads** (MVP-friendly)
  - Pro: fastest for demos
  - Con: requires manual refresh
- **Public proxies**
  - EPS estimates are rarely fully public; flows can be approximated via ETF flows or 13F deltas (still delayed).

### 3.2 Normalization / entity resolution

To connect signals ↔ KG:
- Maintain a clean mapping of `cik ↔ entityId` for companies
- Enrich `entities.identifiers` with `ticker`, `CIK`
- Add a helper job that backfills `signals.subjectEntityId` for rows where the company entity appears later.

### 3.3 Better scoring & explainability

Enhancements:
- Store both **level** and **revision** metrics (e.g., EPS NTM delta, estimate dispersion)
- Robust trend detection:
  - use linear regression slope, or median-of-diffs, not just endpoints
- Flow signal:
  - handle weekly/daily flows correctly; compute rolling sums
- Add citations for structured data:
  - create a `signal_sources` table keyed by `sourceRef` and include vendor metadata/license

### 3.4 Performance

- Indexes already exist on `(cik, signalKey, asOfDate)`
- For large universes, add materialized views for rolling windows per signalKey.

---

## 4) Demo script (what to run)

1) Ingest signals (JSON) via `/api/ingest/signals`
2) Ask in chat:
   - “Find companies with rising EPS estimates and positive fund inflows.”
3) Follow-up:
   - “For the top 3 results, show what filings say that might explain the EPS revisions and flows (with citations).”


