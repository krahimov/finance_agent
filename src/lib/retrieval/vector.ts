import { embedTexts, getEmbeddingModel } from "@/lib/embeddings/openai";
import { getQdrantClient } from "@/lib/qdrant/client";
import { DOC_CHUNKS_COLLECTION } from "@/lib/qdrant/collections";

export type VectorSearchFilters = {
  cik?: string;
  docType?: "10-k" | "10-q" | "20-f" | "6-k";
  accessionNo?: string;
};

export type VectorSearchHit = {
  score: number;
  chunkId: string;
  documentId: string;
  payload: Record<string, unknown>;
};

export type VectorSearchResult = {
  model: string;
  hits: VectorSearchHit[];
};

export async function vectorSearchChunks(opts: {
  query: string;
  topK?: number;
  filters?: VectorSearchFilters;
}): Promise<VectorSearchResult> {
  const q = opts.query.trim();
  if (!q) return { model: getEmbeddingModel(), hits: [] };

  const topK = Math.max(1, Math.min(opts.topK ?? 10, 50));
  const [vector] = await embedTexts([q]);

  const cikVal = opts.filters?.cik?.trim();
  const docTypeVal = opts.filters?.docType;
  const accessionNoVal = opts.filters?.accessionNo?.trim();

  const cikMust: Array<{ key: string; match: { value: string } }> = [];
  if (cikVal) {
    // Stored CIKs are normalized (no leading zeros).
    const cik = cikVal.replace(/^0+/, "");
    cikMust.push({ key: "cik", match: { value: cik } });
  }

  const docTypeMust: Array<{ key: string; match: { value: string } }> = [];
  if (docTypeVal) {
    docTypeMust.push({ key: "doc_type", match: { value: docTypeVal } });
  }

  const accessionMust: Array<{ key: string; match: { value: string } }> = [];
  if (accessionNoVal) {
    accessionMust.push({ key: "accession_no", match: { value: accessionNoVal } });
  }

  async function searchWith(must: Array<{ key: string; match: { value: string } }>) {
    const qdrant = getQdrantClient();
    const res: Array<{
      id: string | number;
      score: number;
      payload?: Record<string, unknown> | null;
    }> = await qdrant.search(DOC_CHUNKS_COLLECTION, {
      vector,
      limit: topK,
      with_payload: true,
      filter: must.length ? { must } : undefined,
    });

    const hits: VectorSearchHit[] = (res ?? []).map((p) => {
      const payload = p.payload ?? {};
      return {
        score: p.score,
        chunkId: String(payload["chunk_id"] ?? p.id),
        documentId: String(payload["document_id"] ?? ""),
        payload,
      };
    });

    return hits;
  }

  // The model can easily guess wrong docType/accessionNo and over-filter to zero hits.
  // Try progressively broader filters.
  const attempts: Array<Array<{ key: string; match: { value: string } }>> = [];
  attempts.push([...cikMust, ...docTypeMust, ...accessionMust]);
  attempts.push([...cikMust, ...docTypeMust]); // drop accession
  attempts.push([...cikMust]); // drop docType + accession
  attempts.push([]); // global fallback (last resort)

  // De-dupe attempts
  const seen = new Set<string>();
  const uniqueAttempts = attempts.filter((a) => {
    const key = JSON.stringify(a);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let hits: VectorSearchHit[] = [];
  for (const must of uniqueAttempts) {
    hits = await searchWith(must);
    if (hits.length > 0) break;
  }

  return { model: getEmbeddingModel(), hits };
}


