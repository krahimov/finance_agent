import { getSql } from "./client";

export type ServiceHealth = {
  ok: boolean;
  latency_ms: number;
  message?: string;
};

export async function postgresHealthCheck(): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const sql = getSql();
    await sql`select 1 as ok`;
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}


