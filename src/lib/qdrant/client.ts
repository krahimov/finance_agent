import { QdrantClient } from "@qdrant/js-client-rest";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

export type QdrantConfig = {
  url: string;
  apiKey?: string;
};

export function getQdrantConfig(): QdrantConfig {
  const apiKey = process.env.QDRANT_API_KEY?.trim();
  return {
    url: requireEnv("QDRANT_URL"),
    apiKey: apiKey || undefined,
  };
}

const globalForQdrant = globalThis as unknown as {
  __qdrantClient?: QdrantClient;
};

export function getQdrantClient(): QdrantClient {
  if (globalForQdrant.__qdrantClient) return globalForQdrant.__qdrantClient;

  const { url, apiKey } = getQdrantConfig();
  const client = new QdrantClient({ url, apiKey });

  if (process.env.NODE_ENV !== "production") {
    globalForQdrant.__qdrantClient = client;
  }

  return client;
}


