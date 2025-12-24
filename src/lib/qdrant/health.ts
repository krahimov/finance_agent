import { getQdrantClient } from "./client";

export type ServiceHealth = {
  ok: boolean;
  latency_ms: number;
  message?: string;
};

export async function qdrantHealthCheck(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const client = getQdrantClient();
    await client.getCollections();
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}


