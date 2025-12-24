import { z } from "zod";

import { applyCorrection } from "@/lib/corrections/apply";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    action: z.enum(["retract", "supersede", "override"]),
    targetAssertionId: z.string().uuid(),
    reason: z.string().optional(),
    createdBy: z.string().optional(),
    newAssertion: z
      .object({
        subjectEntityId: z.string().uuid().optional(),
        predicate: z
          .enum(["BENEFITS_FROM", "EXPOSED_TO", "SUPPLIES_TO", "IMPACTS"])
          .optional(),
        objectEntityId: z.string().uuid().optional(),
        confidence: z.number().min(0).max(1).optional(),
        sourceDocumentId: z.string().uuid().optional(),
        sourceChunkId: z.string().uuid().nullable().optional(),
      })
      .optional(),
  })
  .refine(
    (v) => (v.action === "retract" ? v.newAssertion === undefined : true),
    { message: "newAssertion is not used for retract." },
  )
  .refine(
    (v) => (v.action === "retract" ? true : v.newAssertion !== undefined),
    { message: "newAssertion is required for supersede/override." },
  );

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

  const result = await applyCorrection(parsed.data);
  return Response.json(result);
}


