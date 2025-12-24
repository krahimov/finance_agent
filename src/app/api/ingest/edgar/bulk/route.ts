import pLimit from "p-limit";
import { z } from "zod";

import { ingestEdgarLatest } from "@/lib/edgar/ingest";
import { extractAndProjectDocument } from "@/lib/extraction/run";

export const runtime = "nodejs";

const bodySchema = z.object({
  ciks: z.array(z.string().min(1)).min(1).max(50),
  forms: z.array(z.enum(["10-K", "10-Q", "20-F", "6-K"])).optional(),
  maxFilings: z.number().int().positive().max(20).optional(),
  maxChunksPerFiling: z.number().int().positive().max(500).optional(),
  concurrency: z.number().int().min(1).max(6).optional().default(2),
  // Optional: trigger extraction after ingestion.
  // Warning: this will call the LLM and can be slow/expensive.
  extract: z.boolean().optional().default(false),
  extractMaxChunks: z.number().int().positive().max(200).optional().default(40),
  extractConcurrency: z.number().int().min(1).max(3).optional().default(1),
  extractDocsPerCik: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .default(1)
    .describe("How many of the most recent ingested filings per CIK to extract."),
  stream: z
    .boolean()
    .optional()
    .describe(
      "When true, returns application/x-ndjson progress events (recommended when extract=true).",
    ),
});

function isAuthorized(req: Request): boolean {
  const secret = process.env.INGESTION_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("x-ingestion-secret")?.trim();
  return header === secret;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const {
    ciks,
    concurrency,
    extract,
    extractConcurrency,
    extractMaxChunks,
    extractDocsPerCik,
    stream,
    ...ingestOpts
  } = parsed.data;

  const shouldStream = stream ?? extract; // default to streaming when extraction is enabled

  type IngestedRow =
    | { cik: string; ok: true; result: Awaited<ReturnType<typeof ingestEdgarLatest>>; ms: number }
    | { cik: string; ok: false; error: string; ms: number };

  type ExtractedRow =
    | { documentId: string; ok: true; result: unknown; ms: number }
    | { documentId: string; ok: false; error: string; ms: number };

  const run = async (write?: (obj: unknown) => void) => {
    const ingestLimit = pLimit(concurrency);
    const ingested: IngestedRow[] = [];

    if (write) write({ event: "start", requested: ciks.length, extract });

    await Promise.all(
      ciks.map((cik) =>
        ingestLimit(async () => {
          const started = Date.now();
          write?.({ event: "ingest.start", cik });
          try {
            const result = await ingestEdgarLatest({ cik, ...ingestOpts });
            const row: IngestedRow = {
              cik: result.cik,
              ok: true,
              result,
              ms: Date.now() - started,
            };
            ingested.push(row);
            write?.({
              event: "ingest.done",
              cik: result.cik,
              ms: row.ms,
              inserted_documents: result.inserted_documents,
              inserted_chunks: result.inserted_chunks,
              skipped_existing: result.skipped_existing,
              considered: result.considered,
            });
          } catch (e) {
            const row: IngestedRow = {
              cik,
              ok: false,
              error: e instanceof Error ? e.message : String(e),
              ms: Date.now() - started,
            };
            ingested.push(row);
            write?.({ event: "ingest.error", cik, ms: row.ms, error: row.error });
          }
        }),
      ),
    );

    // Optional extraction phase
    let extracted: ExtractedRow[] | null = null;
    if (extract) {
      const docIds = ingested
        .flatMap((r) =>
          r.ok
            ? r.result.documents.slice(0, extractDocsPerCik).map((d) => d.documentId)
            : [],
        )
        .filter(Boolean);

      extracted = [];
      const extractLimit = pLimit(extractConcurrency);
      await Promise.all(
        docIds.map((documentId) =>
          extractLimit(async () => {
            const started = Date.now();
            write?.({
              event: "extract.start",
              documentId,
              maxChunks: extractMaxChunks,
            });
            try {
              const res = await extractAndProjectDocument({
                documentId,
                maxChunks: extractMaxChunks,
              });
              const row: ExtractedRow = {
                documentId,
                ok: true,
                result: res,
                ms: Date.now() - started,
              };
              extracted!.push(row);
              write?.({ event: "extract.done", documentId, ms: row.ms, result: res });
            } catch (e) {
              const row: ExtractedRow = {
                documentId,
                ok: false,
                error: e instanceof Error ? e.message : String(e),
                ms: Date.now() - started,
              };
              extracted!.push(row);
              write?.({ event: "extract.error", documentId, ms: row.ms, error: row.error });
            }
          }),
        ),
      );
    }

    const ok =
      ingested.every((r) => r.ok) && (extracted?.every((r) => r.ok) ?? true);

    const final = {
      ok,
      requested: ciks.length,
      ingested,
      extracted,
    };
    write?.({ event: "done", ...final });
    return final;
  };

  if (!shouldStream) {
    const final = await run();
    return Response.json(final);
  }

  const encoder = new TextEncoder();
  const streamBody = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (obj: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };
      // Run async without blocking start(); close when complete.
      void run(write)
        .then(() => controller.close())
        .catch((e) => {
          write({
            event: "fatal",
            error: e instanceof Error ? e.message : String(e),
          });
          controller.close();
        });
    },
  });

  return new Response(streamBody, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}


