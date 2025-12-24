import crypto from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  assertions,
  documentChunks,
  documents,
  entities,
  entityType,
  extractionRuns,
} from "@/lib/db/schema";
import {
  ensureNeo4jConstraints,
  upsertAssertionEdgesToNeo4j,
  upsertEntitiesToNeo4j,
  upsertFilingAndChunksToNeo4j,
  upsertMentionsToNeo4j,
} from "@/lib/neo4j/project";

import { EXTRACTION_PROMPT_VERSION } from "./prompt";
import { extractFromChunk } from "./extract";
import type { ExtractionOutput } from "./schema";

type EntityType = (typeof entityType.enumValues)[number];
type AssertionPredicate = "BENEFITS_FROM" | "EXPOSED_TO" | "SUPPLIES_TO" | "IMPACTS";

function normalizeEntityType(raw: string): EntityType {
  const t = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (
    t === "company" ||
    t === "instrument" ||
    t === "sector" ||
    t === "country" ||
    t === "event" ||
    t === "concept" ||
    t === "indicator"
  ) {
    return t;
  }

  // Common LLM variants/synonyms
  if (["org", "organization", "corp", "corporation", "issuer", "entity"].includes(t)) {
    return "company";
  }
  if (["stock", "security", "bond", "equity", "etf", "index"].includes(t)) {
    return "instrument";
  }
  if (["industry", "vertical"].includes(t)) {
    return "sector";
  }
  if (["nation", "region", "geography"].includes(t)) {
    return "country";
  }
  if (["metric", "kpi", "financial_metric"].includes(t)) {
    return "indicator";
  }

  return "concept";
}

function normalizePredicate(raw: string): AssertionPredicate | null {
  const p = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!p) return null;
  if (p === "BENEFITS_FROM" || p === "EXPOSED_TO" || p === "SUPPLIES_TO" || p === "IMPACTS") {
    return p;
  }

  // Common synonyms the model produces:
  if (["AFFECTS", "AFFECTS_NEGATIVELY", "AFFECTS_POSITIVELY", "IMPACT", "IMPACTS_ON", "AFFECTS_ON"].includes(p)) {
    return "IMPACTS";
  }
  if (["BENEFITS", "PROFITS_FROM", "GAINS_FROM", "BENEFITS"].includes(p)) {
    return "BENEFITS_FROM";
  }
  if (["EXPOSED", "RISK_FROM", "RISK_OF", "DEPENDENT_ON", "DEPENDENCE_ON", "SUBJECT_TO"].includes(p)) {
    return "EXPOSED_TO";
  }
  if (["SUPPLIES", "SUPPLIER_TO", "PROVIDES_TO", "SELLS_TO", "SERVES"].includes(p)) {
    return "SUPPLIES_TO";
  }

  return null;
}

function entityKey(name: string): string {
  return name.trim().toLowerCase();
}

function uniqStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function mergeIdentifiers(
  existing: Record<string, string>,
  incoming: Record<string, string> | undefined,
): Record<string, string> {
  return { ...existing, ...(incoming ?? {}) };
}

function normalizeIdentifiers(
  incoming: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!incoming) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (!k) continue;
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    else if (v == null) continue;
    else {
      try {
        out[k] = JSON.stringify(v);
      } catch {
        out[k] = String(v);
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

async function findOrCreateEntity(opts: {
  type: EntityType;
  name: string;
  aliases?: string[];
  identifiers?: Record<string, string>;
}): Promise<{ id: string; type: EntityType; name: string }> {
  const db = getDb();
  const canonicalName = opts.name.trim();
  const type = opts.type;

  const existing = await db
    .select({
      id: entities.id,
      aliases: entities.aliases,
      identifiers: entities.identifiers,
    })
    .from(entities)
    .where(and(eq(entities.type, type), eq(entities.canonicalName, canonicalName)))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    const mergedAliases = uniqStrings([
      ...(row.aliases ?? []),
      ...(opts.aliases ?? []),
    ]);
    const mergedIdentifiers = mergeIdentifiers(
      row.identifiers ?? {},
      opts.identifiers,
    );

    // Only update if something changed.
    const aliasesChanged =
      JSON.stringify(mergedAliases) !== JSON.stringify(row.aliases ?? []);
    const identifiersChanged =
      JSON.stringify(mergedIdentifiers) !== JSON.stringify(row.identifiers ?? {});

    if (aliasesChanged || identifiersChanged) {
      await db
        .update(entities)
        .set({
          aliases: mergedAliases,
          identifiers: mergedIdentifiers,
          updatedAt: new Date(),
        })
        .where(eq(entities.id, row.id));
    }

    return { id: row.id, type, name: canonicalName };
  }

  const id = crypto.randomUUID();
  await db.insert(entities).values({
    id,
    type,
    canonicalName,
    aliases: uniqStrings(opts.aliases ?? []),
    identifiers: opts.identifiers ?? {},
  });

  return { id, type, name: canonicalName };
}

export type ExtractionRunResult = {
  documentId: string;
  extractionRunId: string;
  attemptedChunks: number;
  processedChunks: number;
  failedChunks: number;
  failures: Array<{ chunkId: string; chunkIndex: number; error: string }>;
  entitiesUpserted: number;
  assertionsInserted: number;
  neo4jEdgesUpserted: number;
};

export async function extractAndProjectDocument(opts: {
  documentId: string;
  maxChunks?: number;
}): Promise<ExtractionRunResult> {
  const db = getDb();

  const docRows = await db
    .select({
      id: documents.id,
      cik: documents.cik,
      accessionNo: documents.accessionNo,
      docType: documents.docType,
      filingDate: documents.filingDate,
    })
    .from(documents)
    .where(eq(documents.id, opts.documentId))
    .limit(1);

  if (docRows.length === 0) {
    throw new Error(`Document not found: ${opts.documentId}`);
  }

  const doc = docRows[0];

  const chunkRows = await db
    .select({
      id: documentChunks.id,
      documentId: documentChunks.documentId,
      chunkIndex: documentChunks.chunkIndex,
      text: documentChunks.text,
    })
    .from(documentChunks)
    .where(eq(documentChunks.documentId, doc.id))
    .orderBy(documentChunks.chunkIndex);

  const selectedChunks =
    opts.maxChunks && opts.maxChunks > 0
      ? chunkRows.slice(0, opts.maxChunks)
      : chunkRows;

  const model =
    process.env.OPENAI_EXTRACTION_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-5.2";

  const extractionRunId = crypto.randomUUID();
  await db.insert(extractionRuns).values({
    id: extractionRunId,
    model,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    parameters: { documentId: doc.id, maxChunks: opts.maxChunks ?? null },
    startedAt: new Date(),
  });

  await ensureNeo4jConstraints();
  await upsertFilingAndChunksToNeo4j({
    filing: {
      documentId: doc.id,
      cik: doc.cik,
      accessionNo: doc.accessionNo,
      docType: doc.docType,
      filingDate: String(doc.filingDate),
    },
    chunks: selectedChunks.map((c) => ({
      id: c.id,
      documentId: c.documentId,
      chunkIndex: c.chunkIndex,
    })),
  });

  let processedChunks = 0;
  let attemptedChunks = 0;
  let failedChunks = 0;
  const failures: Array<{ chunkId: string; chunkIndex: number; error: string }> = [];
  let entitiesUpserted = 0;
  let assertionsInserted = 0;
  let neo4jEdgesUpserted = 0;

  for (const chunk of selectedChunks) {
    attemptedChunks += 1;

    let output: ExtractionOutput;
    try {
      const extraction = await extractFromChunk({ chunkText: chunk.text });
      output = extraction.output;
    } catch (e) {
      failedChunks += 1;
      failures.push({
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        error: e instanceof Error ? e.message : String(e),
      });
      // Continue with other chunks; a single bad chunk shouldn't fail the whole document.
      continue;
    }

    const nameToEntity = new Map<
      string,
      { id: string; type: EntityType; name: string }
    >();
    for (const e of output.entities) {
      const ent = await findOrCreateEntity({
        type: normalizeEntityType(e.type),
        name: e.name,
        aliases: e.aliases,
        identifiers: normalizeIdentifiers(e.identifiers),
      });
      nameToEntity.set(entityKey(ent.name), ent);
    }

    // Ensure subject/object entities referenced by relations exist.
    for (const rel of output.relations) {
      const subjectKey = entityKey(rel.subject);
      const objectKey = entityKey(rel.object);

      if (!nameToEntity.has(subjectKey)) {
        const ent = await findOrCreateEntity({
          type: "concept",
          name: rel.subject,
        });
        nameToEntity.set(entityKey(ent.name), ent);
      }
      if (!nameToEntity.has(objectKey)) {
        const ent = await findOrCreateEntity({
          type: "concept",
          name: rel.object,
        });
        nameToEntity.set(entityKey(ent.name), ent);
      }
    }

    const uniqueEntities = [...nameToEntity.values()];
    entitiesUpserted += uniqueEntities.length;

    await upsertEntitiesToNeo4j(
      uniqueEntities.map((e) => ({ id: e.id, type: e.type, name: e.name })),
    );

    // Mention edges: Chunk -> Entity (helps retrieval + provenance).
    const mentionValidFrom = new Date().toISOString();
    await upsertMentionsToNeo4j(
      uniqueEntities.map((e) => ({
        chunkId: chunk.id,
        entityId: e.id,
        confidence: 0.6,
        sourceDocumentId: doc.id,
        validFrom: mentionValidFrom,
      })),
    );

    // Assertions: Entity -> Entity edges with provenance, versioning.
    const now = new Date();
    const assertionRows: (typeof assertions.$inferInsert)[] = [];
    const edgeRows: Array<{
      assertionId: string;
      predicate: AssertionPredicate;
      subjectEntityId: string;
      objectEntityId: string;
      confidence: number;
      sourceDocumentId: string;
      sourceChunkId: string;
      validFrom: string;
      validTo: string | null;
      status: "active";
    }> = [];

    for (const rel of output.relations) {
      const subject = nameToEntity.get(entityKey(rel.subject));
      const object = nameToEntity.get(entityKey(rel.object));
      if (!subject || !object) continue;
      if (subject.id === object.id) continue;

      const id = crypto.randomUUID();
      const predicate = normalizePredicate(rel.predicate);
      if (!predicate) continue;

      assertionRows.push({
        id,
        subjectEntityId: subject.id,
        predicate,
        objectEntityId: object.id,
        confidence: rel.confidence,
        sourceDocumentId: doc.id,
        sourceChunkId: chunk.id,
        extractionRunId,
        validFrom: now,
        status: "active",
      });

      edgeRows.push({
        assertionId: id,
        predicate,
        subjectEntityId: subject.id,
        objectEntityId: object.id,
        confidence: rel.confidence,
        sourceDocumentId: doc.id,
        sourceChunkId: chunk.id,
        validFrom: now.toISOString(),
        validTo: null,
        status: "active",
      });
    }

    if (assertionRows.length > 0) {
      await db.insert(assertions).values(assertionRows);
      assertionsInserted += assertionRows.length;

      await upsertAssertionEdgesToNeo4j(edgeRows);
      neo4jEdgesUpserted += edgeRows.length;
    }

    processedChunks += 1;
  }

  await db
    .update(extractionRuns)
    .set({ finishedAt: new Date() })
    .where(eq(extractionRuns.id, extractionRunId));

  return {
    documentId: doc.id,
    extractionRunId,
    attemptedChunks,
    processedChunks,
    failedChunks,
    failures: failures.slice(0, 25), // cap to keep payloads reasonable
    entitiesUpserted,
    assertionsInserted,
    neo4jEdgesUpserted,
  };
}


