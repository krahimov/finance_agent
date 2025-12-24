import type { Node, Path, Relationship } from "neo4j-driver";

import { getNeo4jDriver } from "@/lib/neo4j/client";

const ALLOWED_EDGE_TYPES = ["BENEFITS_FROM", "EXPOSED_TO", "SUPPLIES_TO", "IMPACTS"] as const;
type AllowedEdgeType = (typeof ALLOWED_EDGE_TYPES)[number];

export type GraphNode = {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
};

export type GraphEdge = {
  type: string;
  from: string;
  to: string;
  properties: Record<string, unknown>;
};

export type GraphResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

function sanitizeEdgeTypes(types?: string[]): AllowedEdgeType[] {
  if (!types || types.length === 0) return [...ALLOWED_EDGE_TYPES];
  const out: AllowedEdgeType[] = [];
  for (const t of types) {
    if ((ALLOWED_EDGE_TYPES as readonly string[]).includes(t)) {
      out.push(t as AllowedEdgeType);
    }
  }
  return out.length ? out : [...ALLOWED_EDGE_TYPES];
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function nodeId(node: Node): string {
  const props = node.properties as Record<string, unknown>;
  const id = props["entityId"] ?? props["documentId"] ?? props["chunkId"];
  return typeof id === "string" || typeof id === "number" ? String(id) : "";
}

export async function graphTraverse(opts: {
  seedEntityIds: string[];
  edgeTypes?: string[];
  depth?: number;
  limit?: number;
}): Promise<GraphResult> {
  const seed = opts.seedEntityIds?.[0]?.trim();
  if (!seed) return { nodes: [], edges: [] };

  const edgeTypes = sanitizeEdgeTypes(opts.edgeTypes);
  const depth = clampInt(opts.depth ?? 2, 1, 3);
  const limit = clampInt(opts.limit ?? 25, 1, 200);

  const relTypeUnion = edgeTypes.join("|");
  const query = `MATCH p=(s:Entity {entityId: $seed})-[:${relTypeUnion}*1..${depth}]-(n:Entity)
                 RETURN p
                 LIMIT toInteger($limit)`;

  const driver = getNeo4jDriver();
  const session = driver.session();
  try {
    const res = await session.run(query, { seed, limit });

    const nodesById = new Map<string, GraphNode>();
    const edgesByKey = new Map<string, GraphEdge>();

    for (const record of res.records) {
      const path = record.get("p") as Path;
      const segments = path.segments ?? [];

      for (const seg of segments) {
        const start = seg.start as Node;
        const end = seg.end as Node;
        const rel = seg.relationship as Relationship;

        const startId = nodeId(start);
        const endId = nodeId(end);
        if (!startId || !endId) continue;

        if (!nodesById.has(startId)) {
          nodesById.set(startId, {
            id: startId,
            labels: start.labels,
            properties: start.properties as Record<string, unknown>,
          });
        }
        if (!nodesById.has(endId)) {
          nodesById.set(endId, {
            id: endId,
            labels: end.labels,
            properties: end.properties as Record<string, unknown>,
          });
        }

        const relProps = rel.properties as Record<string, unknown>;
        const assertionId = relProps["assertionId"];
        const assertionIdStr =
          typeof assertionId === "string" || typeof assertionId === "number"
            ? String(assertionId)
            : "";
        const key = `${rel.type}:${assertionIdStr}:${startId}->${endId}`;
        if (!edgesByKey.has(key)) {
          edgesByKey.set(key, {
            type: rel.type,
            from: startId,
            to: endId,
            properties: rel.properties as Record<string, unknown>,
          });
        }
      }
    }

    return {
      nodes: [...nodesById.values()],
      edges: [...edgesByKey.values()],
    };
  } finally {
    await session.close();
  }
}

export async function explainPath(opts: {
  fromEntityId: string;
  toEntityId: string;
  edgeTypes?: string[];
  maxHops?: number;
}): Promise<GraphResult> {
  const from = opts.fromEntityId.trim();
  const to = opts.toEntityId.trim();
  if (!from || !to) return { nodes: [], edges: [] };

  const edgeTypes = sanitizeEdgeTypes(opts.edgeTypes);
  const maxHops = clampInt(opts.maxHops ?? 4, 1, 6);

  const relTypeUnion = edgeTypes.join("|");
  const query = `MATCH p=shortestPath((a:Entity {entityId: $from})-[:${relTypeUnion}*..${maxHops}]-(b:Entity {entityId: $to}))
                 RETURN p
                 LIMIT 1`;

  const driver = getNeo4jDriver();
  const session = driver.session();
  try {
    const res = await session.run(query, { from, to });
    if (res.records.length === 0) return { nodes: [], edges: [] };

    const record = res.records[0];
    const path = record.get("p") as Path;
    const segments = path.segments ?? [];

    const nodesById = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    for (const seg of segments) {
      const start = seg.start as Node;
      const end = seg.end as Node;
      const rel = seg.relationship as Relationship;

      const startId = nodeId(start);
      const endId = nodeId(end);
      if (!startId || !endId) continue;

      if (!nodesById.has(startId)) {
        nodesById.set(startId, {
          id: startId,
          labels: start.labels,
          properties: start.properties as Record<string, unknown>,
        });
      }
      if (!nodesById.has(endId)) {
        nodesById.set(endId, {
          id: endId,
          labels: end.labels,
          properties: end.properties as Record<string, unknown>,
        });
      }

      edges.push({
        type: rel.type,
        from: startId,
        to: endId,
        properties: rel.properties as Record<string, unknown>,
      });
    }

    return { nodes: [...nodesById.values()], edges };
  } finally {
    await session.close();
  }
}


