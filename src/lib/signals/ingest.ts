import crypto from "node:crypto";

import { sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { entities, signals } from "@/lib/db/schema";

function normalizeCik(cik: string): string {
  return cik.trim().replace(/^0+/, "");
}

async function maybeResolveCompanyEntityIdByCik(cik: string): Promise<string | null> {
  const db = getDb();

  // Try to find an existing company entity where identifiers->>'CIK' equals the normalized cik.
  // This keeps the signals layer connected to the KG when possible, but doesn't require it.
  const rows = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      sql`${entities.type} = 'company' and ${entities.identifiers} ->> 'CIK' = ${cik}`,
    )
    .limit(1);

  return rows.length ? rows[0]!.id : null;
}

export type SignalIngestRow = {
  cik: string;
  signalKey: string;
  asOfDate: string; // YYYY-MM-DD
  value: number;
  unit?: string;
  source?: string;
  sourceRef?: string;
  sourceUrl?: string;
  confidence?: number;
  raw?: Record<string, unknown>;
};

export type SignalIngestResult = {
  inserted: number;
  updated: number;
  resolvedEntityIds: number;
};

export async function ingestSignals(rows: SignalIngestRow[]): Promise<SignalIngestResult> {
  const db = getDb();

  let inserted = 0;
  let updated = 0;
  let resolvedEntityIds = 0;

  for (const r of rows) {
    const cik = normalizeCik(r.cik);
    const signalKey = r.signalKey.trim();
    const asOfDate = r.asOfDate.trim();

    if (!cik || !signalKey || !asOfDate) continue;
    if (!Number.isFinite(r.value)) continue;

    const subjectEntityId = await maybeResolveCompanyEntityIdByCik(cik);
    if (subjectEntityId) resolvedEntityIds += 1;

    const id = crypto.randomUUID();
    const now = new Date();
    const source = (r.source?.trim() || "manual").slice(0, 128);

    const existed = await db
      .select({ id: signals.id })
      .from(signals)
      .where(
        sql`${signals.cik} = ${cik} and ${signals.signalKey} = ${signalKey} and ${signals.asOfDate} = ${asOfDate} and ${signals.source} = ${source}`,
      )
      .limit(1);

    // Upsert by (cik, signalKey, asOfDate, source)
    await db
      .insert(signals)
      .values({
        id,
        cik,
        subjectEntityId,
        signalKey,
        asOfDate,
        value: r.value,
        unit: r.unit?.trim(),
        source,
        sourceRef: r.sourceRef?.trim(),
        sourceUrl: r.sourceUrl?.trim(),
        confidence:
          typeof r.confidence === "number" && Number.isFinite(r.confidence)
            ? Math.max(0, Math.min(1, r.confidence))
            : 0.9,
        raw: r.raw ?? {},
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [signals.cik, signals.signalKey, signals.asOfDate, signals.source],
        set: {
          subjectEntityId,
          value: r.value,
          unit: r.unit?.trim(),
          sourceRef: r.sourceRef?.trim(),
          sourceUrl: r.sourceUrl?.trim(),
          confidence:
            typeof r.confidence === "number" && Number.isFinite(r.confidence)
              ? Math.max(0, Math.min(1, r.confidence))
              : 0.9,
          raw: r.raw ?? {},
          updatedAt: now,
        },
      })
      .returning({ id: signals.id });

    if (existed.length > 0) updated += 1;
    else inserted += 1;
  }

  return { inserted, updated, resolvedEntityIds };
}


