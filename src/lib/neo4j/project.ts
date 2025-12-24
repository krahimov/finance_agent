import type { Session } from "neo4j-driver";

import { getNeo4jDriver } from "./client";

type EntityType =
  | "company"
  | "instrument"
  | "sector"
  | "country"
  | "event"
  | "concept"
  | "indicator";

type EntityRow = { id: string; type: EntityType; name: string };

type FilingRow = {
  documentId: string;
  cik: string;
  accessionNo: string;
  docType: "10-k" | "10-q" | "20-f" | "6-k";
  filingDate: string;
};

type ChunkRow = { id: string; documentId: string; chunkIndex: number };

type MentionRow = {
  chunkId: string;
  entityId: string;
  confidence: number;
  sourceDocumentId: string;
  validFrom: string;
};

type AssertionEdgeRow = {
  assertionId: string;
  predicate: "BENEFITS_FROM" | "EXPOSED_TO" | "SUPPLIES_TO" | "IMPACTS";
  subjectEntityId: string;
  objectEntityId: string;
  confidence: number;
  sourceDocumentId: string;
  sourceChunkId: string;
  validFrom: string;
  validTo?: string | null;
  status?: "active" | "retracted" | "superseded";
};

function labelForEntityType(type: EntityType): string {
  switch (type) {
    case "company":
      return "Company";
    case "instrument":
      return "Instrument";
    case "sector":
      return "Sector";
    case "country":
      return "Country";
    case "event":
      return "Event";
    case "concept":
      return "Concept";
    case "indicator":
      return "Indicator";
    default:
      return "Entity";
  }
}

async function withSession<T>(fn: (session: Session) => Promise<T>): Promise<T> {
  const driver = getNeo4jDriver();
  const session = driver.session();
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

async function ensureConstraints(session: Session): Promise<void> {
  await session.run(
    "CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (n:Entity) REQUIRE n.entityId IS UNIQUE",
  );
  await session.run(
    "CREATE INDEX entity_type_idx IF NOT EXISTS FOR (n:Entity) ON (n.type)",
  );
  await session.run(
    "CREATE INDEX entity_name_idx IF NOT EXISTS FOR (n:Entity) ON (n.name)",
  );
  await session.run(
    "CREATE CONSTRAINT filing_document_id IF NOT EXISTS FOR (n:Filing) REQUIRE n.documentId IS UNIQUE",
  );
  await session.run(
    "CREATE CONSTRAINT chunk_chunk_id IF NOT EXISTS FOR (n:Chunk) REQUIRE n.chunkId IS UNIQUE",
  );
}

export async function ensureNeo4jConstraints(): Promise<void> {
  await withSession(async (session) => {
    await ensureConstraints(session);
  });
}

export async function upsertEntitiesToNeo4j(rows: EntityRow[]): Promise<void> {
  if (rows.length === 0) return;

  // Split by label because Neo4j labels and relationship types cannot be parametrized.
  const byLabel = new Map<string, EntityRow[]>();
  for (const r of rows) {
    const label = labelForEntityType(r.type);
    const list = byLabel.get(label) ?? [];
    list.push(r);
    byLabel.set(label, list);
  }

  await withSession(async (session) => {
    await ensureConstraints(session);

    for (const [label, list] of byLabel.entries()) {
      await session.run(
        `UNWIND $rows AS row
         MERGE (n:Entity:${label} {entityId: row.id})
         SET n.name = row.name,
             n.type = row.type`,
        { rows: list },
      );
    }
  });
}

export async function upsertFilingAndChunksToNeo4j(opts: {
  filing: FilingRow;
  chunks: ChunkRow[];
}): Promise<void> {
  await withSession(async (session) => {
    await ensureConstraints(session);

    await session.run(
      `MERGE (f:Filing {documentId: $documentId})
       SET f.cik = $cik,
           f.accessionNo = $accessionNo,
           f.docType = $docType,
           f.filingDate = $filingDate`,
      opts.filing,
    );

    if (opts.chunks.length === 0) return;

    await session.run(
      `MATCH (f:Filing {documentId: $documentId})
       UNWIND $chunks AS row
       MERGE (c:Chunk {chunkId: row.id})
       SET c.documentId = row.documentId,
           c.chunkIndex = row.chunkIndex
       MERGE (f)-[:HAS_CHUNK]->(c)`,
      {
        documentId: opts.filing.documentId,
        chunks: opts.chunks,
      },
    );
  });
}

export async function upsertMentionsToNeo4j(rows: MentionRow[]): Promise<void> {
  if (rows.length === 0) return;

  await withSession(async (session) => {
    await ensureConstraints(session);

    await session.run(
      `UNWIND $rows AS row
       MATCH (c:Chunk {chunkId: row.chunkId})
       MATCH (e:Entity {entityId: row.entityId})
       MERGE (c)-[r:MENTIONS]->(e)
       SET r.confidence = row.confidence,
           r.sourceDocumentId = row.sourceDocumentId,
           r.validFrom = row.validFrom`,
      { rows },
    );
  });
}

export async function upsertAssertionEdgesToNeo4j(rows: AssertionEdgeRow[]): Promise<void> {
  if (rows.length === 0) return;

  const byType = new Map<AssertionEdgeRow["predicate"], AssertionEdgeRow[]>();
  for (const r of rows) {
    const list = byType.get(r.predicate) ?? [];
    list.push(r);
    byType.set(r.predicate, list);
  }

  await withSession(async (session) => {
    await ensureConstraints(session);

    for (const [predicate, list] of byType.entries()) {
      await session.run(
        `UNWIND $rows AS row
         MATCH (s:Entity {entityId: row.subjectEntityId})
         MATCH (o:Entity {entityId: row.objectEntityId})
         MERGE (s)-[r:${predicate} {assertionId: row.assertionId}]->(o)
         SET r.confidence = row.confidence,
             r.sourceDocumentId = row.sourceDocumentId,
             r.sourceChunkId = row.sourceChunkId,
             r.validFrom = row.validFrom,
             r.validTo = row.validTo,
             r.status = row.status`,
        { rows: list },
      );
    }
  });
}

export async function closeAssertionEdgesInNeo4j(opts: {
  assertionIds: string[];
  status: "retracted" | "superseded";
  validTo: string;
}): Promise<{ updated: number }> {
  const ids = [...new Set(opts.assertionIds.filter(Boolean))];
  if (ids.length === 0) return { updated: 0 };

  return await withSession(async (session) => {
    await ensureConstraints(session);

    const res = await session.run(
      `UNWIND $ids AS assertionId
       MATCH ()-[r]->()
       WHERE r.assertionId = assertionId
       SET r.validTo = $validTo,
           r.status = $status
       RETURN count(r) AS updated`,
      {
        ids,
        validTo: opts.validTo,
        status: opts.status,
      },
    );

    const updated = res.records?.[0]?.get("updated");
    return { updated: typeof updated === "number" ? updated : Number(updated) };
  });
}


