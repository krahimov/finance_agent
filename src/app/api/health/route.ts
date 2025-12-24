import { postgresHealthCheck } from "@/lib/db/health";
import { neo4jHealthCheck } from "@/lib/neo4j/health";
import { qdrantHealthCheck } from "@/lib/qdrant/health";

export const runtime = "nodejs";

export async function GET() {
  const [postgres, neo4j, qdrant] = await Promise.all([
    postgresHealthCheck(),
    neo4jHealthCheck(),
    qdrantHealthCheck(),
  ]);

  const ok = postgres.ok && neo4j.ok && qdrant.ok;

  return Response.json(
    {
      ok,
      timestamp: new Date().toISOString(),
      services: { postgres, neo4j, qdrant },
    },
    { status: ok ? 200 : 503 },
  );
}


