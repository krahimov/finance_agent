"use server";

import { revalidatePath } from "next/cache";

import type { EdgarIngestResult } from "@/lib/edgar/ingest";
import { ingestEdgarLatest } from "@/lib/edgar/ingest";
import type { ExtractionRunResult } from "@/lib/extraction/run";
import { extractAndProjectDocument } from "@/lib/extraction/run";

export type ActionState<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function runEdgarIngestionAction(
  _prevState: ActionState<EdgarIngestResult> | null,
  formData: FormData,
): Promise<ActionState<EdgarIngestResult>> {
  try {
    const cik = String(formData.get("cik") ?? "").trim();
    const maxFilings = Number(formData.get("maxFilings") ?? 1);
    const maxChunksPerFiling = Number(formData.get("maxChunksPerFiling") ?? 40);

    if (!cik) return { ok: false, error: "CIK is required." };

    const data = await ingestEdgarLatest({
      cik,
      maxFilings: Number.isFinite(maxFilings) ? maxFilings : 1,
      maxChunksPerFiling: Number.isFinite(maxChunksPerFiling)
        ? maxChunksPerFiling
        : 40,
    });

    revalidatePath("/ingestion");
    return { ok: true, data };
  } catch (err) {
    console.error("runEdgarIngestionAction error:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runExtractionAction(
  _prevState: ActionState<ExtractionRunResult> | null,
  formData: FormData,
): Promise<ActionState<ExtractionRunResult>> {
  try {
    const documentId = String(formData.get("documentId") ?? "").trim();
    const maxChunksRaw = String(formData.get("maxChunks") ?? "").trim();
    const maxChunks = maxChunksRaw ? Number(maxChunksRaw) : undefined;

    if (!documentId) return { ok: false, error: "documentId is required." };

    const data = await extractAndProjectDocument({
      documentId,
      maxChunks:
        maxChunks !== undefined && Number.isFinite(maxChunks) ? maxChunks : undefined,
    });

    revalidatePath("/ingestion");
    return { ok: true, data };
  } catch (err) {
    console.error("runExtractionAction error:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}


