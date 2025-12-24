import { eq, inArray } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { assertions, documentChunks, documents } from "@/lib/db/schema";

export type ChunkCitation = {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  document: {
    cik: string;
    accessionNo: string;
    docType: "10-k" | "10-q" | "20-f" | "6-k";
    filingDate: string;
    url: string;
  };
};

export async function getCitationsByChunkIds(chunkIds: string[]): Promise<ChunkCitation[]> {
  const ids = [...new Set(chunkIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const db = getDb();
  const rows = await db
    .select({
      chunkId: documentChunks.id,
      documentId: documentChunks.documentId,
      chunkIndex: documentChunks.chunkIndex,
      text: documentChunks.text,
      cik: documents.cik,
      accessionNo: documents.accessionNo,
      docType: documents.docType,
      filingDate: documents.filingDate,
      url: documents.url,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .where(inArray(documentChunks.id, ids));

  const byId = new Map(rows.map((r) => [r.chunkId, r]));

  // Preserve input order
  return ids
    .map((id) => {
      const r = byId.get(id);
      if (!r) return null;
      return {
        chunkId: r.chunkId,
        documentId: r.documentId,
        chunkIndex: r.chunkIndex,
        text: r.text,
        document: {
          cik: r.cik,
          accessionNo: r.accessionNo,
          docType: r.docType,
          filingDate: String(r.filingDate),
          url: r.url,
        },
      } satisfies ChunkCitation;
    })
    .filter(Boolean) as ChunkCitation[];
}

export async function getCitationsByAssertionIds(
  assertionIds: string[],
): Promise<Array<{ assertionId: string; citation: ChunkCitation | null }>> {
  const ids = [...new Set(assertionIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const db = getDb();
  const rows = await db
    .select({
      assertionId: assertions.id,
      chunkId: assertions.sourceChunkId,
    })
    .from(assertions)
    .where(inArray(assertions.id, ids));

  const chunkIds = rows
    .map((r) => r.chunkId)
    .filter((c): c is string => Boolean(c));
  const citations = await getCitationsByChunkIds(chunkIds);
  const citationByChunkId = new Map(citations.map((c) => [c.chunkId, c]));

  const chunkIdByAssertionId = new Map(rows.map((r) => [r.assertionId, r.chunkId]));

  return ids.map((assertionId) => {
    const chunkId = chunkIdByAssertionId.get(assertionId) ?? null;
    const citation = chunkId ? citationByChunkId.get(chunkId) ?? null : null;
    return { assertionId, citation };
  });
}


