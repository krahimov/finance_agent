import crypto from "node:crypto";

import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { assertions, corrections } from "@/lib/db/schema";
import {
  closeAssertionEdgesInNeo4j,
  upsertAssertionEdgesToNeo4j,
} from "@/lib/neo4j/project";

export type CorrectionAction = "retract" | "supersede" | "override";

export type ApplyCorrectionInput = {
  action: CorrectionAction;
  targetAssertionId: string;
  reason?: string;
  createdBy?: string;
  newAssertion?: Partial<{
    subjectEntityId: string;
    predicate: "BENEFITS_FROM" | "EXPOSED_TO" | "SUPPLIES_TO" | "IMPACTS";
    objectEntityId: string;
    confidence: number;
    sourceDocumentId: string;
    sourceChunkId: string | null;
  }>;
};

export type ApplyCorrectionResult = {
  targetAssertionId: string;
  action: CorrectionAction;
  correctionId: string;
  newAssertionId: string | null;
  neo4jClosedEdges: number;
};

export async function applyCorrection(
  input: ApplyCorrectionInput,
): Promise<ApplyCorrectionResult> {
  const db = getDb();

  const targetRows = await db
    .select({
      id: assertions.id,
      subjectEntityId: assertions.subjectEntityId,
      predicate: assertions.predicate,
      objectEntityId: assertions.objectEntityId,
      confidence: assertions.confidence,
      sourceDocumentId: assertions.sourceDocumentId,
      sourceChunkId: assertions.sourceChunkId,
      status: assertions.status,
    })
    .from(assertions)
    .where(eq(assertions.id, input.targetAssertionId))
    .limit(1);

  if (targetRows.length === 0) {
    throw new Error(`Assertion not found: ${input.targetAssertionId}`);
  }

  const target = targetRows[0];
  const now = new Date();
  const validTo = now.toISOString();

  const correctionId = crypto.randomUUID();
  let newAssertionId: string | null = null;

  if (input.action === "retract") {
    await db.transaction(async (tx) => {
      await tx
        .update(assertions)
        .set({ status: "retracted", validTo: now })
        .where(eq(assertions.id, target.id));

      await tx.insert(corrections).values({
        id: correctionId,
        targetAssertionId: target.id,
        action: "retract",
        reason: input.reason,
        createdBy: input.createdBy,
        newAssertionId: null,
      });
    });

    const neo = await closeAssertionEdgesInNeo4j({
      assertionIds: [target.id],
      status: "retracted",
      validTo,
    });

    return {
      targetAssertionId: target.id,
      action: input.action,
      correctionId,
      newAssertionId: null,
      neo4jClosedEdges: neo.updated,
    };
  }

  // supersede/override: create a new assertion + close the old one.
  const next = input.newAssertion ?? {};
  const subjectEntityId = next.subjectEntityId ?? target.subjectEntityId;
  const predicate = (next.predicate ?? target.predicate) as ApplyCorrectionInput["newAssertion"]["predicate"];
  const objectEntityId = next.objectEntityId ?? target.objectEntityId;
  const sourceDocumentId = next.sourceDocumentId ?? target.sourceDocumentId;
  const sourceChunkId = next.sourceChunkId ?? target.sourceChunkId ?? null;
  const confidence = next.confidence ?? 0.9;

  if (!objectEntityId) {
    throw new Error(
      "Cannot supersede/override an assertion without objectEntityId (provide newAssertion.objectEntityId).",
    );
  }
  if (!predicate) {
    throw new Error(
      "Cannot supersede/override an assertion without a predicate (provide newAssertion.predicate).",
    );
  }

  newAssertionId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx
      .update(assertions)
      .set({ status: "superseded", validTo: now })
      .where(eq(assertions.id, target.id));

    await tx.insert(assertions).values({
      id: newAssertionId!,
      subjectEntityId,
      predicate,
      objectEntityId,
      confidence,
      sourceDocumentId,
      sourceChunkId,
      extractionRunId: null,
      validFrom: now,
      validTo: null,
      status: "active",
    });

    await tx.insert(corrections).values({
      id: correctionId,
      targetAssertionId: target.id,
      action: input.action,
      reason: input.reason,
      createdBy: input.createdBy,
      newAssertionId,
    });
  });

  const neoClosed = await closeAssertionEdgesInNeo4j({
    assertionIds: [target.id],
    status: "superseded",
    validTo,
  });

  await upsertAssertionEdgesToNeo4j([
    {
      assertionId: newAssertionId,
      predicate,
      subjectEntityId,
      objectEntityId,
      confidence,
      sourceDocumentId,
      sourceChunkId: sourceChunkId ?? "",
      validFrom: now.toISOString(),
      validTo: null,
      status: "active",
    },
  ]);

  return {
    targetAssertionId: target.id,
    action: input.action,
    correctionId,
    newAssertionId,
    neo4jClosedEdges: neoClosed.updated,
  };
}


