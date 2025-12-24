import { z } from "zod";

import { ingestEdgarLatest } from "@/lib/edgar/ingest";

export const runtime = "nodejs";

const bodySchema = z.object({
  cik: z.string().min(1),
  forms: z.array(z.enum(["10-K", "10-Q", "20-F", "6-K"])).optional(),
  maxFilings: z.number().int().positive().max(10).optional(),
  maxChunksPerFiling: z.number().int().positive().max(500).optional(),
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

  const result = await ingestEdgarLatest(parsed.data);
  return Response.json(result);
}


