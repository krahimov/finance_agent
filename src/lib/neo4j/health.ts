import { getNeo4jDriver } from "./client";

export type ServiceHealth = {
  ok: boolean;
  latency_ms: number;
  message?: string;
};

export async function neo4jHealthCheck(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const driver = getNeo4jDriver();
    const session = driver.session();
    try {
      await session.run("RETURN 1 as ok");
    } finally {
      await session.close();
    }

    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}


