import { and, eq, ilike, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { entities, type entityType } from "@/lib/db/schema";

export type EntitySearchResult = {
  id: string;
  type: (typeof entityType.enumValues)[number];
  canonicalName: string;
  identifiers: Record<string, string>;
};

export async function searchEntities(opts: {
  query: string;
  type?: (typeof entityType.enumValues)[number];
  limit?: number;
}): Promise<EntitySearchResult[]> {
  const db = getDb();
  const qRaw = opts.query.trim();
  const q = qRaw.replace(/\s+/g, " ");
  if (!q) return [];

  const limit = Math.max(1, Math.min(opts.limit ?? 10, 50));

  // Generate a few safe variants so "Apple Inc." still matches "Apple", etc.
  const variants = new Set<string>();
  variants.add(q);
  variants.add(q.replace(/[,].*$/, "").trim()); // before comma
  variants.add(
    q
      .replace(/\b(incorporated|inc\.?|corp\.?|corporation|ltd\.?|limited|llc|plc|holdings?)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
  if (q.includes(" ")) variants.add(q.split(" ")[0]!.trim());
  variants.delete("");

  const nameConds = [...variants].map((v) => ilike(entities.canonicalName, `%${v}%`));

  const qUpper = q.toUpperCase();
  const looksLikeTicker = /^[A-Z]{1,5}$/.test(qUpper);
  const digitsOnly = q.replace(/[^\d]/g, "");
  const looksLikeCik = /^\d{6,10}$/.test(digitsOnly);

  const extraConds: Array<ReturnType<typeof sql>> = [];
  if (looksLikeTicker) {
    extraConds.push(eq(sql`${entities.identifiers} ->> 'ticker'`, qUpper));
  }
  if (looksLikeCik) {
    // Store might have formatted CIKs (e.g. with dashes); do a contains match on digits.
    extraConds.push(ilike(sql`${entities.identifiers} ->> 'cik'`, `%${digitsOnly}%`));
  }

  const anyMatch = or(...nameConds, ...extraConds);
  const where = opts.type ? and(eq(entities.type, opts.type), anyMatch) : anyMatch;

  const rows = await db
    .select({
      id: entities.id,
      type: entities.type,
      canonicalName: entities.canonicalName,
      identifiers: entities.identifiers,
    })
    .from(entities)
    .where(where)
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    canonicalName: r.canonicalName,
    identifiers: r.identifiers ?? {},
  }));
}


