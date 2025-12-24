import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { documents, entities } from "@/lib/db/schema";

export type DocumentRow = {
  id: string;
  cik: string;
  accessionNo: string;
  docType: "10-k" | "10-q" | "20-f" | "6-k";
  filingDate: string;
  url: string;
};

function normalizeCikLike(input: string): string {
  return input.trim().replace(/^0+/, "");
}

async function resolveCikFilter(input: string): Promise<string | null> {
  const raw = input.trim();
  if (!raw) return null;

  const digitsOnly = raw.replace(/[^\d]/g, "");
  if (/^\d{4,10}$/.test(digitsOnly)) {
    return normalizeCikLike(digitsOnly);
  }

  const db = getDb();

  // Ticker lookup (best-effort). Many users will pass "MSFT" here.
  const ticker = raw.toUpperCase();
  if (/^[A-Z.]{1,6}$/.test(ticker)) {
    const rows = await db
      .select({
        cik: sql<string | null>`coalesce(${entities.identifiers} ->> 'cik', ${entities.identifiers} ->> 'CIK')`,
      })
      .from(entities)
      .where(
        and(
          eq(entities.type, "company"),
          eq(sql`${entities.identifiers} ->> 'ticker'`, ticker),
        ),
      )
      .limit(1);

    const cik = rows[0]?.cik ?? null;
    if (cik) return normalizeCikLike(cik);
  }

  // Name lookup (fallback). If we have a company entity with a stored CIK identifier, use it.
  const rows2 = await db
    .select({
      cik: sql<string | null>`coalesce(${entities.identifiers} ->> 'cik', ${entities.identifiers} ->> 'CIK')`,
    })
    .from(entities)
    .where(
      and(
        eq(entities.type, "company"),
        ilike(entities.canonicalName, `%${raw}%`),
        or(
          sql`${entities.identifiers} ? 'cik'`,
          sql`${entities.identifiers} ? 'CIK'`,
        ),
      ),
    )
    .limit(1);

  const cik2 = rows2[0]?.cik ?? null;
  if (cik2) return normalizeCikLike(cik2);

  return null;
}

export async function listDocuments(opts: {
  cik?: string;
  docType?: "10-k" | "10-q" | "20-f" | "6-k";
  accessionNo?: string;
  limit?: number;
}): Promise<DocumentRow[]> {
  const db = getDb();
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 100));

  const conditions: SQL[] = [];
  if (opts.cik?.trim()) {
    // Stored CIKs are normalized (no leading zeros). Accept CIK, ticker, or company name.
    const resolved = (await resolveCikFilter(opts.cik)) ?? normalizeCikLike(opts.cik);
    // If this is not a numeric CIK, it won't match documents.cik; callers should pass a real CIK
    // or ensure company entities exist for ticker/name resolution.
    if (/^\d+$/.test(resolved)) {
      conditions.push(eq(documents.cik, resolved));
    } else {
      // Keep behavior explicit: no match if non-numeric.
      conditions.push(eq(documents.cik, resolved));
    }
  }
  if (opts.docType) {
    conditions.push(eq(documents.docType, opts.docType));
  }
  if (opts.accessionNo?.trim()) {
    conditions.push(eq(documents.accessionNo, opts.accessionNo.trim()));
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: documents.id,
      cik: documents.cik,
      accessionNo: documents.accessionNo,
      docType: documents.docType,
      filingDate: documents.filingDate,
      url: documents.url,
    })
    .from(documents)
    .where(where)
    .orderBy(desc(documents.filingDate))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    cik: r.cik,
    accessionNo: r.accessionNo,
    docType: r.docType,
    filingDate: String(r.filingDate),
    url: r.url,
  }));
}


