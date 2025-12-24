import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { entities } from "@/lib/db/schema";
import type { MassiveBenzingaEarningsRow } from "@/lib/providers/massive/benzingaEarnings";

import type { SignalIngestRow } from "../ingest";

function normalizeCik(cik: string): string {
  return cik.trim().replace(/^0+/, "");
}

async function resolveCikByTicker(tickerRaw: string): Promise<string | null> {
  const ticker = tickerRaw.trim().toUpperCase();
  if (!ticker) return null;

  const db = getDb();
  const rows = await db
    .select({
      cik: sql<string | null>`coalesce(${entities.identifiers} ->> 'cik', ${entities.identifiers} ->> 'CIK')`,
    })
    .from(entities)
    .where(
      sql`${entities.type} = 'company' and ${entities.identifiers} ->> 'ticker' = ${ticker}`,
    )
    .limit(1);

  const cik = rows[0]?.cik ?? null;
  return cik ? normalizeCik(cik) : null;
}

function toDateOnly(s: string | undefined | null): string | null {
  if (!s) return null;
  // ISO8601 -> YYYY-MM-DD
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function safeKeyPart(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export async function benzingaEarningsToSignalRows(opts: {
  rows: MassiveBenzingaEarningsRow[];
  // For "rising estimates", we usually care about the NEXT upcoming earnings estimate.
  // We'll also emit period-specific keys for traceability.
  includeNextAlias?: boolean; // default true
}): Promise<SignalIngestRow[]> {
  const out: SignalIngestRow[] = [];
  const includeNextAlias = opts.includeNextAlias ?? true;

  // Group by ticker for "next upcoming" alias.
  const byTicker = new Map<string, MassiveBenzingaEarningsRow[]>();
  for (const r of opts.rows) {
    const ticker = r.ticker?.trim().toUpperCase();
    if (!ticker) continue;
    const list = byTicker.get(ticker) ?? [];
    list.push(r);
    byTicker.set(ticker, list);
  }

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  for (const [ticker, rows] of byTicker.entries()) {
    const cik = await resolveCikByTicker(ticker);
    if (!cik) continue;

    // Sort by earnings date ascending to find the "next" event.
    const sortedByDate = [...rows].sort((a, b) => {
      const da = a.date ?? "";
      const db = b.date ?? "";
      return da < db ? -1 : da > db ? 1 : 0;
    });

    const next = includeNextAlias
      ? sortedByDate.find((r) => (r.date ?? "") >= todayStr && typeof r.estimated_eps === "number")
      : undefined;

    for (const r of rows) {
      if (typeof r.estimated_eps !== "number") continue;
      if (!r.fiscal_period || !r.fiscal_year) continue;

      const asOf = toDateOnly(r.last_updated) ?? toDateOnly(r.date) ?? null;
      if (!asOf) continue;

      const periodKey = `eps_est_${safeKeyPart(r.fiscal_period)}_${r.fiscal_year}`;
      out.push({
        cik,
        signalKey: periodKey,
        asOfDate: asOf,
        value: r.estimated_eps,
        unit: r.currency || "USD",
        source: "massive_benzinga",
        sourceRef: r.benzinga_id,
        sourceUrl: "https://massive.com/docs/rest/partners/benzinga/earnings",
        confidence: 0.9,
        raw: {
          ticker,
          benzinga_id: r.benzinga_id,
          company_name: r.company_name,
          fiscal_period: r.fiscal_period,
          fiscal_year: r.fiscal_year,
          earnings_date: r.date,
          last_updated: r.last_updated,
          eps_method: r.eps_method,
          importance: r.importance,
        },
      });
    }

    if (next && typeof next.estimated_eps === "number") {
      const asOf = toDateOnly(next.last_updated) ?? toDateOnly(next.date) ?? null;
      if (asOf) {
        out.push({
          cik,
          signalKey: "eps_est_next",
          asOfDate: asOf,
          value: next.estimated_eps,
          unit: next.currency || "USD",
          source: "massive_benzinga",
          sourceRef: next.benzinga_id,
          sourceUrl: "https://massive.com/docs/rest/partners/benzinga/earnings",
          confidence: 0.9,
          raw: {
            ticker,
            benzinga_id: next.benzinga_id,
            company_name: next.company_name,
            fiscal_period: next.fiscal_period,
            fiscal_year: next.fiscal_year,
            earnings_date: next.date,
            last_updated: next.last_updated,
            eps_method: next.eps_method,
            importance: next.importance,
            alias: true,
          },
        });
      }
    }
  }

  return out;
}


