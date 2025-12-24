import { z } from "zod";

import { fetchBenzingaEarnings } from "@/lib/providers/massive/benzingaEarnings";
import { ingestSignals } from "@/lib/signals/ingest";
import { benzingaEarningsToSignalRows } from "@/lib/signals/providers/benzingaEarnings";

export const runtime = "nodejs";

const bodySchema = z.object({
  tickers: z.array(z.string().min(1)).min(1).max(200),
  // Use Massive's delta cursor support.
  lastUpdatedGte: z.string().optional().describe("ISO8601 or YYYY-MM-DD"),
  // Optional additional filters
  dateGte: z.string().optional().describe("YYYY-MM-DD"),
  dateLte: z.string().optional().describe("YYYY-MM-DD"),
  limit: z.number().int().min(1).max(50000).optional().default(5000),
  includeNextAlias: z.boolean().optional().default(true),
});

function isAuthorized(req: Request): boolean {
  const secret = process.env.INGESTION_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("x-ingestion-secret")?.trim();
  return header === secret;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!process.env.MASSIVE_API_KEY?.trim()) {
    return new Response("Missing MASSIVE_API_KEY in server env.", { status: 500 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { tickers, lastUpdatedGte, dateGte, dateLte, limit, includeNextAlias } =
    parsed.data;

  const allRows = [];
  const perTicker: Array<{
    ticker: string;
    fetched: number;
    skippedNoCik: boolean;
  }> = [];

  for (const t of tickers) {
    const ticker = t.trim().toUpperCase();
    if (!ticker) continue;

    const res = await fetchBenzingaEarnings({
      ticker,
      lastUpdatedGte,
      dateGte,
      dateLte,
      limit,
      sort: "last_updated.desc",
    });

    const rows = (res.results ?? []).filter(Boolean);
    const signalRows = await benzingaEarningsToSignalRows({
      rows,
      includeNextAlias,
    });

    // If we can't map ticker->CIK yet, signalRows will be empty for that ticker.
    perTicker.push({
      ticker,
      fetched: rows.length,
      skippedNoCik: signalRows.length === 0 && rows.length > 0,
    });

    allRows.push(...signalRows);
  }

  const ingestResult = await ingestSignals(allRows);

  return Response.json({
    ok: true,
    tickersRequested: tickers.length,
    rowsFetched: perTicker.reduce((a, b) => a + b.fetched, 0),
    signalRowsPrepared: allRows.length,
    ingest: ingestResult,
    perTicker,
    notes: {
      signalKeys: ["eps_est_next", "eps_est_<fiscal_period>_<fiscal_year>"],
      source: "massive_benzinga",
      doc: "https://massive.com/docs/rest/partners/benzinga/earnings",
    },
  });
}


