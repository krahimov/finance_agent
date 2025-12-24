import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }
  return value;
}

export function getDatabaseUrl(): string {
  // Fail fast (especially important in serverless).
  return requireEnv("DATABASE_URL");
}

const globalForDb = globalThis as unknown as {
  __postgres?: ReturnType<typeof postgres>;
  __drizzleDb?: ReturnType<typeof drizzle>;
};

export function getSql() {
  if (globalForDb.__postgres) return globalForDb.__postgres;

  const sql = postgres(getDatabaseUrl(), {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__postgres = sql;
  }

  return sql;
}

export function getDb() {
  if (globalForDb.__drizzleDb) return globalForDb.__drizzleDb;
  const db = drizzle(getSql(), { schema });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__drizzleDb = db;
  }

  return db;
}

export { schema };


