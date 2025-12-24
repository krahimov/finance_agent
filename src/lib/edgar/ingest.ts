import crypto from "node:crypto";

import { and, eq, ilike, or, sql } from "drizzle-orm";

import { embedTexts } from "@/lib/embeddings/openai";
import { getDb } from "@/lib/db/client";
import { documentChunks, documents, entities } from "@/lib/db/schema";
import { DOC_CHUNKS_COLLECTION, ensureDocChunksCollection } from "@/lib/qdrant/collections";
import { getQdrantClient } from "@/lib/qdrant/client";
import { chunkTextByChars } from "@/lib/text/chunk";
import { stripHtmlToText } from "@/lib/text/normalize";

import { buildFilingDocumentUrl, fetchFilingDocumentText, fetchSubmission } from "./fetch";

type EdgarForm = "10-K" | "10-Q" | "20-F" | "6-K";

type FilingCandidate = {
  accessionNo: string;
  filingDate: string; // YYYY-MM-DD
  form: EdgarForm;
  primaryDocument: string;
};

export type EdgarIngestOptions = {
  cik: string;
  forms?: EdgarForm[];
  maxFilings?: number;
  maxChunksPerFiling?: number;
  chunkSize?: number;
  overlap?: number;
  embeddingBatchSize?: number;
};

export type EdgarIngestResult = {
  cik: string;
  considered: number;
  skipped_existing: number;
  inserted_documents: number;
  inserted_chunks: number;
  qdrant_points_upserted: number;
  documents: Array<{
    accessionNo: string;
    docType: "10-k" | "10-q" | "20-f" | "6-k";
    filingDate: string;
    documentId: string;
    chunks: number;
  }>;
};

function normalizeCik(cik: string): string {
  return cik.replace(/^0+/, "");
}

async function upsertCompanyEntityFromSubmission(opts: {
  cik: string;
  name: string;
  tickers?: string[];
}): Promise<void> {
  const db = getDb();
  const cik = normalizeCik(opts.cik);
  const name = opts.name.trim();
  const ticker = opts.tickers?.[0]?.trim()?.toUpperCase();

  if (!cik || !name) return;

  const existing = await db
    .select({
      id: entities.id,
      canonicalName: entities.canonicalName,
      identifiers: entities.identifiers,
      aliases: entities.aliases,
    })
    .from(entities)
    .where(
      and(
        eq(entities.type, "company"),
        or(
          eq(sql`${entities.identifiers} ->> 'cik'`, cik),
          eq(sql`${entities.identifiers} ->> 'CIK'`, cik),
          ilike(entities.canonicalName, `%${name}%`),
        ),
      ),
    )
    .limit(1);

  const nextIdentifiers: Record<string, string> = {
    ...(existing[0]?.identifiers ?? {}),
    cik,
  };
  if (ticker) nextIdentifiers["ticker"] = ticker;

  const nextAliases = Array.isArray(existing[0]?.aliases)
    ? Array.from(new Set([...(existing[0]!.aliases ?? []), name, ticker].filter(Boolean) as string[]))
    : Array.from(new Set([name, ticker].filter(Boolean) as string[]));

  if (existing.length > 0) {
    await db
      .update(entities)
      .set({
        canonicalName: name,
        identifiers: nextIdentifiers,
        aliases: nextAliases,
        updatedAt: new Date(),
      })
      .where(eq(entities.id, existing[0]!.id));
    return;
  }

  await db.insert(entities).values({
    id: crypto.randomUUID(),
    type: "company",
    canonicalName: name,
    aliases: nextAliases,
    identifiers: nextIdentifiers,
  });
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function formToDocType(form: EdgarForm): "10-k" | "10-q" | "20-f" | "6-k" {
  if (form === "10-K") return "10-k";
  if (form === "10-Q") return "10-q";
  if (form === "20-F") return "20-f";
  return "6-k";
}

function pickLatestFilings(submission: Awaited<ReturnType<typeof fetchSubmission>>, forms: EdgarForm[]): FilingCandidate[] {
  const recent = submission.filings?.recent;
  if (!recent) return [];

  const out: FilingCandidate[] = [];
  for (let i = 0; i < recent.form.length; i += 1) {
    const form = recent.form[i] as string;
    if (form !== "10-K" && form !== "10-Q" && form !== "20-F" && form !== "6-K") continue;
    if (!forms.includes(form)) continue;

    const accessionNo = recent.accessionNumber[i];
    const filingDate = recent.filingDate[i];
    const primaryDocument = recent.primaryDocument[i];
    if (!accessionNo || !filingDate || !primaryDocument) continue;

    out.push({
      accessionNo,
      filingDate,
      form,
      primaryDocument,
    });
  }

  out.sort((a, b) => (a.filingDate < b.filingDate ? 1 : a.filingDate > b.filingDate ? -1 : 0));
  return out;
}

export async function ingestEdgarLatest(options: EdgarIngestOptions): Promise<EdgarIngestResult> {
  const cik = normalizeCik(options.cik);
  const forms: EdgarForm[] = options.forms?.length ? options.forms : ["10-K", "10-Q"];
  const maxFilings = options.maxFilings ?? 1;
  const maxChunksPerFiling = options.maxChunksPerFiling ?? 40;
  const chunkSize = options.chunkSize ?? 2200;
  const overlap = options.overlap ?? 200;
  const embeddingBatchSize = options.embeddingBatchSize ?? 64;

  const submission = await fetchSubmission(cik);
  // Ensure a company entity exists so users can search by ticker/name and we can attach signals later.
  await upsertCompanyEntityFromSubmission({
    cik: submission.cik || cik,
    name: submission.name,
    tickers: submission.tickers,
  });
  const candidates = pickLatestFilings(submission, forms).slice(0, maxFilings);

  const db = getDb();
  const qdrant = getQdrantClient();
  await ensureDocChunksCollection();

  const result: EdgarIngestResult = {
    cik,
    considered: candidates.length,
    skipped_existing: 0,
    inserted_documents: 0,
    inserted_chunks: 0,
    qdrant_points_upserted: 0,
    documents: [],
  };

  for (const filing of candidates) {
    const existing = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.source, "sec_edgar"), eq(documents.accessionNo, filing.accessionNo)))
      .limit(1);

    if (existing.length > 0) {
      result.skipped_existing += 1;
      // Return the existing doc metadata so callers don't interpret an empty `documents: []` as failure.
      const existingId = existing[0]!.id;
      const existingDoc = await db
        .select({
          id: documents.id,
          docType: documents.docType,
          filingDate: documents.filingDate,
        })
        .from(documents)
        .where(eq(documents.id, existingId))
        .limit(1);

      const chunkCount = await db
        .select({ id: documentChunks.id })
        .from(documentChunks)
        .where(eq(documentChunks.documentId, existingId));

      if (existingDoc.length > 0) {
        result.documents.push({
          accessionNo: filing.accessionNo,
          docType: existingDoc[0]!.docType,
          filingDate: String(existingDoc[0]!.filingDate),
          documentId: existingId,
          chunks: chunkCount.length,
        });
      }
      continue;
    }

    const url = buildFilingDocumentUrl({
      cik,
      accessionNo: filing.accessionNo,
      primaryDocument: filing.primaryDocument,
    });

    const html = await fetchFilingDocumentText({
      cik,
      accessionNo: filing.accessionNo,
      primaryDocument: filing.primaryDocument,
    });

    const text = stripHtmlToText(html);
    const hash = sha256(text);

    const documentId = crypto.randomUUID();
    const docType = formToDocType(filing.form);

    await db.insert(documents).values({
      id: documentId,
      source: "sec_edgar",
      docType,
      cik,
      accessionNo: filing.accessionNo,
      filingDate: filing.filingDate,
      url,
      hash,
    });

    const chunks = chunkTextByChars(text, { chunkSize, overlap }).slice(0, maxChunksPerFiling);
    const chunkRows = chunks.map((c) => {
      const chunkId = crypto.randomUUID();
      return {
        id: chunkId,
        documentId,
        chunkIndex: c.index,
        text: c.text,
        startChar: c.startChar,
        endChar: c.endChar,
        qdrantPointId: chunkId,
      };
    });

    if (chunkRows.length > 0) {
      await db.insert(documentChunks).values(chunkRows);
    }

    // Embed + upsert into Qdrant in batches
    const points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> = [];

    for (let i = 0; i < chunkRows.length; i += embeddingBatchSize) {
      const batch = chunkRows.slice(i, i + embeddingBatchSize);
      const embeddings = await embedTexts(batch.map((b) => b.text));
      for (let j = 0; j < batch.length; j += 1) {
        const row = batch[j];
        points.push({
          id: row.qdrantPointId!,
          vector: embeddings[j],
          payload: {
            chunk_id: row.id,
            document_id: documentId,
            cik,
            accession_no: filing.accessionNo,
            doc_type: docType,
            filing_date: filing.filingDate,
            chunk_index: row.chunkIndex,
          },
        });
      }
    }

    if (points.length > 0) {
      await qdrant.upsert(DOC_CHUNKS_COLLECTION, {
        wait: true,
        points,
      });
    }

    result.inserted_documents += 1;
    result.inserted_chunks += chunkRows.length;
    result.qdrant_points_upserted += points.length;
    result.documents.push({
      accessionNo: filing.accessionNo,
      docType,
      filingDate: filing.filingDate,
      documentId,
      chunks: chunkRows.length,
    });
  }

  return result;
}


