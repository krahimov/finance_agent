import { detectConflicts } from "@/lib/conflicts/detect";

export const runtime = "nodejs";

export async function GET() {
  const conflicts = await detectConflicts();
  return Response.json({ conflicts, count: conflicts.length });
}


