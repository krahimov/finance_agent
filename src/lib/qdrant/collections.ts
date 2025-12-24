import { getQdrantClient } from "./client";

export const DOC_CHUNKS_COLLECTION = "doc_chunks";

export function getEmbeddingVectorSize(): number {
  const raw = process.env.QDRANT_VECTOR_SIZE?.trim();
  if (!raw) return 1536; // text-embedding-3-small
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Invalid QDRANT_VECTOR_SIZE; expected a positive number.");
  }
  return parsed;
}

async function ensurePayloadIndexes(): Promise<void> {
  const client = getQdrantClient();

  // Qdrant Cloud can require an explicit payload index for filtering on keyword fields.
  // These fields are used by our `vectorSearch` filters.
  const indexes: Array<{ field_name: string; field_schema: "keyword" }> = [
    { field_name: "cik", field_schema: "keyword" },
    { field_name: "doc_type", field_schema: "keyword" },
    { field_name: "accession_no", field_schema: "keyword" },
    { field_name: "document_id", field_schema: "keyword" },
    { field_name: "chunk_id", field_schema: "keyword" },
  ];

  for (const idx of indexes) {
    try {
      await client.createPayloadIndex(DOC_CHUNKS_COLLECTION, {
        wait: true,
        field_name: idx.field_name,
        field_schema: idx.field_schema,
      });
    } catch (err) {
      // Best-effort / idempotent: if the index already exists, ignore.
      // Qdrant client throws ApiError with `{ status, data }`.
      const anyErr = err as {
        status?: number;
        message?: string;
        data?: { status?: { error?: string } };
      };
      const msg: string | undefined = anyErr.data?.status?.error || anyErr.message;
      if (msg && /already exists|exists/i.test(msg)) continue;
      // Some Qdrant versions return 409/400 for "already exists". Ignore those too.
      if (anyErr?.status === 409) continue;
      throw err;
    }
  }
}

export async function ensureDocChunksCollection(): Promise<void> {
  const client = getQdrantClient();
  const existing = await client.getCollections();
  const found = existing.collections?.some((c) => c.name === DOC_CHUNKS_COLLECTION);
  if (found) {
    await ensurePayloadIndexes();
    return;
  }

  await client.createCollection(DOC_CHUNKS_COLLECTION, {
    vectors: {
      size: getEmbeddingVectorSize(),
      distance: "Cosine",
    },
  });

  await ensurePayloadIndexes();
}


