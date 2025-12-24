import { z } from "zod";

import { ingestSignals } from "@/lib/signals/ingest";

export const runtime = "nodejs";

const rowSchema = z.object({
  cik: z.string().min(1),
  signalKey: z.string().min(1),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number(),
  unit: z.string().optional(),
  source: z.string().optional(),
  sourceRef: z.string().optional(),
  sourceUrl: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  raw: z.record(z.string(), z.any()).optional(),
});

const bodySchema = z.object({
  rows: z.array(rowSchema).min(1).max(10000),
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

  const result = await ingestSignals(parsed.data.rows);
  return Response.json({ ok: true, ...result });
}


