import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { signals } from "@/lib/db/schema";

function normalizeCik(cik: string): string {
  return cik.trim().replace(/^0+/, "");
}

export type ScreenSignalsInput = {
  // Universe: either explicit CIKs or "all CIKs present in signals" (default).
  ciks?: string[];

  // EPS: determine "rising" by comparing earliest vs latest within lookback window.
  epsKey?: string; // default "eps_ntm_consensus"
  epsLookbackDays?: number; // default 90
  epsMinDelta?: number; // default 0 (strictly positive)

  // Flows: determine "positive inflows" by summing within lookback window.
  flowKey?: string; // default "fund_flow_4w_usd"
  flowLookbackDays?: number; // default 28
  flowMinSum?: number; // default 0 (strictly positive)

  limit?: number; // default 50
};

export type ScreenSignalsRow = {
  cik: string;
  eps: {
    key: string;
    earliestDate: string;
    earliestValue: number;
    latestDate: string;
    latestValue: number;
    delta: number;
  };
  flows: {
    key: string;
    startDate: string;
    endDate: string;
    sum: number;
  };
};

export type ScreenSignalsResult = {
  epsKey: string;
  flowKey: string;
  epsWindowDays: number;
  flowWindowDays: number;
  matched: number;
  rows: ScreenSignalsRow[];
};

export async function screenSignals(input: ScreenSignalsInput): Promise<ScreenSignalsResult> {
  const db = getDb();

  const epsKey = (input.epsKey?.trim() || "eps_ntm_consensus").slice(0, 128);
  const flowKey = (input.flowKey?.trim() || "fund_flow_4w_usd").slice(0, 128);
  const epsLookbackDays = Math.max(7, Math.min(input.epsLookbackDays ?? 90, 365));
  const flowLookbackDays = Math.max(7, Math.min(input.flowLookbackDays ?? 28, 365));
  const epsMinDelta = Number.isFinite(input.epsMinDelta ?? 0) ? (input.epsMinDelta ?? 0) : 0;
  const flowMinSum = Number.isFinite(input.flowMinSum ?? 0) ? (input.flowMinSum ?? 0) : 0;
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));

  const ciks = (input.ciks ?? []).map(normalizeCik).filter(Boolean);

  // Use DISTINCT ON to fetch earliest and latest EPS in the window per CIK.
  // Then compute delta and join with flow sums.
  type QueryRow = {
    cik: string;
    earliest_date: string;
    earliest_value: number;
    latest_date: string;
    latest_value: number;
    eps_delta: number;
    start_date: string;
    end_date: string;
    flow_sum: number;
  };

  // Build a safe Postgres array literal for the CIK filter.
  const cikArrayLiteral = ciks.length
    ? sql.raw(`WHERE cik = ANY(ARRAY[${ciks.map((c) => `'${c}'`).join(",")}])`)
    : sql``;

  // drizzle's execute returns a driver-specific shape; we normalize below.
  const res = await db.execute(sql`
    WITH universe AS (
      SELECT DISTINCT cik
      FROM ${signals}
      ${cikArrayLiteral}
    ),
    eps_window AS (
      SELECT s.*
      FROM ${signals} s
      JOIN universe u ON u.cik = s.cik
      WHERE s.signal_key = ${epsKey}
        AND s.as_of_date >= (CURRENT_DATE - (${epsLookbackDays}::int * INTERVAL '1 day'))::date
    ),
    eps_latest AS (
      SELECT DISTINCT ON (cik)
        cik,
        as_of_date AS latest_date,
        value AS latest_value
      FROM eps_window
      ORDER BY cik, as_of_date DESC
    ),
    eps_earliest AS (
      SELECT DISTINCT ON (cik)
        cik,
        as_of_date AS earliest_date,
        value AS earliest_value
      FROM eps_window
      ORDER BY cik, as_of_date ASC
    ),
    eps_join AS (
      SELECT
        l.cik,
        e.earliest_date,
        e.earliest_value,
        l.latest_date,
        l.latest_value,
        (l.latest_value - e.earliest_value) AS eps_delta
      FROM eps_latest l
      JOIN eps_earliest e ON e.cik = l.cik
    ),
    flow_window AS (
      SELECT s.*
      FROM ${signals} s
      JOIN universe u ON u.cik = s.cik
      WHERE s.signal_key = ${flowKey}
        AND s.as_of_date >= (CURRENT_DATE - (${flowLookbackDays}::int * INTERVAL '1 day'))::date
    ),
    flow_sum AS (
      SELECT
        cik,
        min(as_of_date) AS start_date,
        max(as_of_date) AS end_date,
        sum(value) AS flow_sum
      FROM flow_window
      GROUP BY cik
    )
    SELECT
      e.cik,
      e.earliest_date,
      e.earliest_value,
      e.latest_date,
      e.latest_value,
      e.eps_delta,
      f.start_date,
      f.end_date,
      f.flow_sum
    FROM eps_join e
    JOIN flow_sum f ON f.cik = e.cik
    WHERE e.eps_delta > ${epsMinDelta}
      AND f.flow_sum > ${flowMinSum}
    ORDER BY f.flow_sum DESC
    LIMIT ${limit};
  `);

  const rawRows: QueryRow[] = (() => {
    const maybeRows = (res as unknown as { rows?: unknown }).rows;
    if (Array.isArray(maybeRows)) return maybeRows as QueryRow[];
    if (Array.isArray(res)) return res as unknown as QueryRow[];
    return [];
  })();

  const out: ScreenSignalsRow[] = rawRows.map((r) => ({
    cik: String(r.cik),
    eps: {
      key: epsKey,
      earliestDate: String(r.earliest_date),
      earliestValue: Number(r.earliest_value),
      latestDate: String(r.latest_date),
      latestValue: Number(r.latest_value),
      delta: Number(r.eps_delta),
    },
    flows: {
      key: flowKey,
      startDate: String(r.start_date),
      endDate: String(r.end_date),
      sum: Number(r.flow_sum),
    },
  }));

  return {
    epsKey,
    flowKey,
    epsWindowDays: epsLookbackDays,
    flowWindowDays: flowLookbackDays,
    matched: out.length,
    rows: out,
  };
}
