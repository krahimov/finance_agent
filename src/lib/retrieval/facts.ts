import { and, desc, eq, type SQL } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { assertions } from "@/lib/db/schema";

export type AssertionRow = {
  id: string;
  subjectEntityId: string;
  predicate: string;
  objectEntityId: string | null;
  confidence: number;
  sourceDocumentId: string;
  sourceChunkId: string | null;
  validFrom: string;
  validTo: string | null;
  status: "active" | "retracted" | "superseded";
};

export async function factsQuery(opts: {
  subjectEntityId?: string;
  predicate?: string;
  objectEntityId?: string;
  status?: "active" | "retracted" | "superseded";
  limit?: number;
}): Promise<AssertionRow[]> {
  const db = getDb();
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));

  const conditions: SQL[] = [];
  if (opts.subjectEntityId) {
    conditions.push(eq(assertions.subjectEntityId, opts.subjectEntityId));
  }
  if (opts.predicate) {
    conditions.push(eq(assertions.predicate, opts.predicate));
  }
  if (opts.objectEntityId) {
    conditions.push(eq(assertions.objectEntityId, opts.objectEntityId));
  }
  if (opts.status) {
    conditions.push(eq(assertions.status, opts.status));
  }

  // If no filters specified, refuse to dump a huge table by default.
  if (conditions.length === 0) return [];

  const where = and(...conditions);

  const rows = await db
    .select({
      id: assertions.id,
      subjectEntityId: assertions.subjectEntityId,
      predicate: assertions.predicate,
      objectEntityId: assertions.objectEntityId,
      confidence: assertions.confidence,
      sourceDocumentId: assertions.sourceDocumentId,
      sourceChunkId: assertions.sourceChunkId,
      validFrom: assertions.validFrom,
      validTo: assertions.validTo,
      status: assertions.status,
    })
    .from(assertions)
    .where(where)
    .orderBy(desc(assertions.validFrom))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    subjectEntityId: r.subjectEntityId,
    predicate: r.predicate,
    objectEntityId: r.objectEntityId ?? null,
    confidence: r.confidence,
    sourceDocumentId: r.sourceDocumentId,
    sourceChunkId: r.sourceChunkId ?? null,
    validFrom: r.validFrom.toISOString(),
    validTo: r.validTo ? r.validTo.toISOString() : null,
    status: r.status,
  }));
}


