import { tool } from "ai";
import z from "zod/v4";

import { postgresHealthCheck } from "@/lib/db/health";
import { neo4jHealthCheck } from "@/lib/neo4j/health";
import { qdrantHealthCheck } from "@/lib/qdrant/health";
import { getCitationsByAssertionIds, getCitationsByChunkIds } from "@/lib/retrieval/citations";
import { listDocuments } from "@/lib/retrieval/documents";
import { searchEntities } from "@/lib/retrieval/entities";
import { factsQuery } from "@/lib/retrieval/facts";
import { explainPath, graphTraverse } from "@/lib/retrieval/graph";
import { timelineSearch } from "@/lib/retrieval/timeline";
import { vectorSearchChunks } from "@/lib/retrieval/vector";
import { screenSignals } from "@/lib/signals/screen";

export type HealthCheckResult = {
  ok: boolean;
  timestamp: string;
  env: {
    hasOpenAIKey: boolean;
    openAIModel: string;
    hasDatabaseUrl: boolean;
    hasNeo4j: boolean;
    hasQdrantUrl: boolean;
  };
  services: {
    postgres: Awaited<ReturnType<typeof postgresHealthCheck>>;
    neo4j: Awaited<ReturnType<typeof neo4jHealthCheck>>;
    qdrant: Awaited<ReturnType<typeof qdrantHealthCheck>>;
  };
};

export const tools = {
  healthCheck: tool({
    description:
      "Checks whether the server is configured correctly (e.g. required env vars).",
    inputSchema: z.object({}),
    execute: async (): Promise<HealthCheckResult> => {
      const [postgres, neo4j, qdrant] = await Promise.all([
        postgresHealthCheck(),
        neo4jHealthCheck(),
        qdrantHealthCheck(),
      ]);

      return {
        ok: postgres.ok && neo4j.ok && qdrant.ok,
        timestamp: new Date().toISOString(),
        env: {
          hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
          openAIModel: process.env.OPENAI_MODEL?.trim() || "gpt-5.2",
          hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
          hasNeo4j:
            Boolean(process.env.NEO4J_URI) &&
            Boolean(process.env.NEO4J_USERNAME) &&
            Boolean(process.env.NEO4J_PASSWORD),
          hasQdrantUrl: Boolean(process.env.QDRANT_URL),
        },
        services: { postgres, neo4j, qdrant },
      };
    },
  }),

  searchEntities: tool({
    description:
      "Searches entities (companies, concepts, events, etc.) by name. Use this to get entity IDs for graph traversal.",
    inputSchema: z.object({
      query: z.string().min(1),
      type: z
        .enum([
          "company",
          "instrument",
          "sector",
          "country",
          "event",
          "concept",
          "indicator",
        ])
        .optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: async (args) => searchEntities(args),
  }),

  vectorSearch: tool({
    description:
      "Semantic search over filing chunks (Qdrant). Returns chunk IDs you can cite via getCitations. filters are OPTIONAL; if unsure, omit them or only set cik. Avoid guessing accessionNo/docType; if you need them, call listDocuments first.",
    inputSchema: z.object({
      query: z.string().min(1),
      topK: z.number().int().min(1).max(50).optional(),
      filters: z
        .object({
          cik: z.string().optional(),
          docType: z.enum(["10-k", "10-q", "20-f", "6-k"]).optional(),
          accessionNo: z.string().optional(),
        })
        .optional(),
    }),
    execute: async (args) => vectorSearchChunks(args),
  }),

  timelineSearch: tool({
    description:
      "Builds an 'over time' semantic view by searching within each of the most recent filings. Use this when the user asks for trends/changes 'over time' or 'across quarters'. Returns chunk IDs per filing; follow with getCitations to quote evidence.",
    inputSchema: z.object({
      query: z.string().min(1).describe("What to search for over time (e.g., 'AI capex', 'export controls', 'tariffs')."),
      cik: z.string().optional().describe("Optional: CIK to scope filings (recommended for time series)."),
      docType: z.enum(["10-k", "10-q", "20-f", "6-k"]).optional().describe("Optional: Restrict to a doc type."),
      limitDocs: z.number().int().min(1).max(24).optional().default(8).describe("How many recent filings to scan."),
      topKPerDoc: z.number().int().min(1).max(10).optional().default(3).describe("How many hits to keep per filing."),
    }),
    execute: async (args) => timelineSearch(args),
  }),

  listDocuments: tool({
    description:
      "Lists ingested filings (Postgres documents table). Use this to discover which accession numbers/docTypes are available before filtering vectorSearch. You can pass a CIK, ticker, or company name.",
    inputSchema: z.object({
      cik: z.string().optional().describe("CIK, ticker, or company name (best-effort resolution)."),
      docType: z.enum(["10-k", "10-q", "20-f", "6-k"]).optional(),
      accessionNo: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    execute: async (args) => listDocuments(args),
  }),

  getCitations: tool({
    description:
      "Fetches source text + document metadata for chunk IDs and/or assertion IDs.",
    inputSchema: z
      .object({
        chunkIds: z.array(z.string().uuid()).optional(),
        assertionIds: z.array(z.string().uuid()).optional(),
      })
      .refine((v) => (v.chunkIds?.length ?? 0) + (v.assertionIds?.length ?? 0) > 0, {
        message: "Provide at least one chunkId or assertionId.",
      }),
    execute: async (args) => {
      const chunkIds = args.chunkIds ?? [];
      const assertionIds = args.assertionIds ?? [];
      const [byChunks, byAssertions] = await Promise.all([
        chunkIds.length ? getCitationsByChunkIds(chunkIds) : Promise.resolve([]),
        assertionIds.length
          ? getCitationsByAssertionIds(assertionIds)
          : Promise.resolve([]),
      ]);
      return { byChunks, byAssertions };
    },
  }),

  factsQuery: tool({
    description:
      "Queries versioned assertions stored in Postgres (filters required). Useful for precise, auditable facts.",
    inputSchema: z.object({
      subjectEntityId: z.string().uuid().optional(),
      predicate: z.string().optional(),
      objectEntityId: z.string().uuid().optional(),
      status: z.enum(["active", "retracted", "superseded"]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    execute: async (args) => factsQuery(args),
  }),

  graphTraverse: tool({
    description:
      "Traverses the Neo4j graph from a seed entity ID and returns nearby nodes/edges.",
    inputSchema: z.object({
      seedEntityIds: z.array(z.string().uuid()).min(1),
      edgeTypes: z
        .array(z.enum(["BENEFITS_FROM", "EXPOSED_TO", "SUPPLIES_TO", "IMPACTS"]))
        .optional(),
      depth: z.number().int().min(1).max(3).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    execute: async (args) => graphTraverse(args),
  }),

  explainPath: tool({
    description:
      "Finds and explains a relationship path between two entities (shortest path within max hops).",
    inputSchema: z.object({
      fromEntityId: z.string().uuid(),
      toEntityId: z.string().uuid(),
      edgeTypes: z
        .array(z.enum(["BENEFITS_FROM", "EXPOSED_TO", "SUPPLIES_TO", "IMPACTS"]))
        .optional(),
      maxHops: z.number().int().min(1).max(6).optional(),
    }),
    execute: async (args) => explainPath(args),
  }),

  echo: tool({
    description: "Echoes the input back unchanged (useful for debugging tools).",
    inputSchema: z.object({
      text: z.string().min(1),
    }),
    execute: async ({ text }: { text: string }) => {
      return { text };
    },
  }),

  screenSignals: tool({
    description:
      "Screens for companies with BOTH rising EPS estimates and positive fund inflows using structured signals stored in Postgres. This requires that EPS/flow time series have been ingested via /api/ingest/signals.",
    inputSchema: z.object({
      ciks: z
        .array(z.string())
        .optional()
        .describe("Optional: restrict universe to these CIKs. If omitted, scans all CIKs present in the signals table."),
      epsKey: z.string().optional().default("eps_est_next").describe("Signal key for EPS consensus series."),
      epsLookbackDays: z.number().int().min(7).max(365).optional().default(90).describe("Lookback window for EPS trend."),
      epsMinDelta: z.number().optional().default(0).describe("Require EPS latest - earliest > epsMinDelta."),
      flowKey: z.string().optional().default("fund_flow_4w_usd").describe("Signal key for fund flows series."),
      flowLookbackDays: z.number().int().min(7).max(365).optional().default(28).describe("Lookback window for flow sum."),
      flowMinSum: z.number().optional().default(0).describe("Require summed flows in window > flowMinSum."),
      limit: z.number().int().min(1).max(200).optional().default(50),
    }),
    execute: async (args) => screenSignals(args),
  }),
};


