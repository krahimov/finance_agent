import { config as loadEnv } from "dotenv";
import type { Config } from "drizzle-kit";

// Prefer Next.js-style local env files.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL for drizzle-kit.");
}

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: DATABASE_URL,
  },
} satisfies Config;


