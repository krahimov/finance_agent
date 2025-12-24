import pLimit from "p-limit";

import { listDocuments } from "@/lib/retrieval/documents";

import { vectorSearchChunks, type VectorSearchFilters } from "./vector";

export type TimelineSearchHit = {
  score: number;
  chunkId: string;
  documentId: string;
  payload: Record<string, unknown>;
};

export type TimelineSearchDocResult = {
  documentId: string;
  cik: string;
  accessionNo: string;
  docType: "10-k" | "10-q" | "20-f" | "6-k";
  filingDate: string; // YYYY-MM-DD
  url: string;
  hits: TimelineSearchHit[];
};

export type TimelineSearchResult = {
  query: string;
  model: string;
  documentsConsidered: number;
  results: TimelineSearchDocResult[];
};

export async function timelineSearch(opts: {
  query: string;
  cik?: string;
  docType?: "10-k" | "10-q" | "20-f" | "6-k";
  limitDocs?: number;
  topKPerDoc?: number;
  concurrency?: number;
}): Promise<TimelineSearchResult> {
  const q = opts.query.trim();
  if (!q) return { query: q, model: "unknown", documentsConsidered: 0, results: [] };

  const limitDocs = Math.max(1, Math.min(opts.limitDocs ?? 8, 24));
  const topKPerDoc = Math.max(1, Math.min(opts.topKPerDoc ?? 3, 10));
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, 6));

  // We use Postgres to enumerate filings (ordered by filing_date desc),
  // then run Qdrant semantic search per filing to build an "over time" view.
  let docs = await listDocuments({
    cik: opts.cik,
    docType: opts.docType,
    limit: limitDocs,
  });

  // Common failure mode: the caller over-filters to docType=10-k, but the DB only has 10-q (or vice versa).
  // If we got 0 documents and a docType filter was provided, retry once without docType.
  if (docs.length === 0 && opts.docType) {
    docs = await listDocuments({
      cik: opts.cik,
      docType: undefined,
      limit: limitDocs,
    });
  }

  const limit = pLimit(concurrency);

  let embeddingModel = "unknown";
  const perDoc = await Promise.all(
    docs.map((d) =>
      limit(async () => {
        const filters: VectorSearchFilters = {
          cik: d.cik,
          docType: d.docType,
          accessionNo: d.accessionNo,
        };

        const res = await vectorSearchChunks({
          query: q,
          topK: topKPerDoc,
          filters,
        });

        embeddingModel = res.model || embeddingModel;

        return {
          documentId: d.id,
          cik: d.cik,
          accessionNo: d.accessionNo,
          docType: d.docType,
          filingDate: d.filingDate,
          url: d.url,
          hits: res.hits.map((h) => ({
            score: h.score,
            chunkId: h.chunkId,
            documentId: h.documentId,
            payload: h.payload,
          })),
        } satisfies TimelineSearchDocResult;
      }),
    ),
  );

  // Only keep documents that had any hits.
  const results = perDoc.filter((r) => r.hits.length > 0);

  return {
    query: q,
    model: embeddingModel,
    documentsConsidered: docs.length,
    results,
  };
}


