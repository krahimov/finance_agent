import { and, eq, inArray, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { assertions } from "@/lib/db/schema";

export const SINGLE_VALUED_PREDICATES = [
  "CEO",
  "HEADQUARTERED_IN",
  "FOUNDED_IN",
] as const;

export type ConflictGroup = {
  subjectEntityId: string;
  predicate: string;
  assertionIds: string[];
  objectEntityIds: Array<string | null>;
};

export async function detectConflicts(opts?: {
  predicates?: string[];
  limit?: number;
}): Promise<ConflictGroup[]> {
  const db = getDb();
  const limit = Math.max(1, Math.min(opts?.limit ?? 2000, 5000));

  const predicates =
    opts?.predicates && opts.predicates.length > 0
      ? opts.predicates
      : [...SINGLE_VALUED_PREDICATES];

  if (predicates.length === 0) return [];

  const rows = await db
    .select({
      id: assertions.id,
      subjectEntityId: assertions.subjectEntityId,
      predicate: assertions.predicate,
      objectEntityId: assertions.objectEntityId,
    })
    .from(assertions)
    .where(
      and(
        eq(assertions.status, "active"),
        isNull(assertions.validTo),
        inArray(assertions.predicate, predicates),
      ),
    )
    .limit(limit);

  const groups = new Map<string, ConflictGroup>();

  for (const r of rows) {
    const key = `${r.subjectEntityId}:${r.predicate}`;
    const g =
      groups.get(key) ??
      ({
        subjectEntityId: r.subjectEntityId,
        predicate: r.predicate,
        assertionIds: [],
        objectEntityIds: [],
      } satisfies ConflictGroup);

    g.assertionIds.push(r.id);
    g.objectEntityIds.push(r.objectEntityId ?? null);
    groups.set(key, g);
  }

  const conflicts: ConflictGroup[] = [];
  for (const g of groups.values()) {
    const distinctObjects = new Set(g.objectEntityIds.map((v) => v ?? "NULL"));
    if (distinctObjects.size > 1) {
      conflicts.push(g);
    }
  }

  return conflicts;
}


