import { z } from "zod";

import { extractAndProjectDocument } from "@/lib/extraction/run";

export const runtime = "nodejs";

const bodySchema = z.object({
  documentId: z.string().uuid(),
  maxChunks: z.number().int().positive().max(500).optional(),
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

  const result = await extractAndProjectDocument(parsed.data);
  return Response.json(result);
}


