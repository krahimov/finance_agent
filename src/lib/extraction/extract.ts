import { generateText, Output } from "ai";
import z from "zod/v4";

import { getExtractionModel } from "@/lib/ai/model";

import { buildExtractionPrompt, EXTRACTION_PROMPT_VERSION } from "./prompt";
import type { ExtractionOutput } from "./schema";

// Define the runtime schema locally to avoid bundler/module interop issues
// causing imported schema values to become undefined in Next/Turbopack.
const extractionOutputSchema = z.object({
  entities: z
    .array(
      z.object({
        type: z.string().min(1),
        name: z.string().min(1),
        identifiers: z.record(z.string(), z.unknown()).optional(),
        aliases: z.array(z.string()).optional(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .default([]),
  relations: z
    .array(
      z.object({
        subject: z.string().min(1),
        predicate: z.string().min(1),
        object: z.string().min(1),
        confidence: z.number().min(0).max(1),
        evidence: z
          .object({
            quote: z.string().min(1).optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try to recover if JSON is wrapped in prose/markdown.
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      const slice = trimmed.slice(first, last + 1);
      return JSON.parse(slice);
    }
    throw new Error("Model did not return valid JSON.");
  }
}

function coerceExtractionShape(value: unknown): unknown {
  // Some models return { entities: "[...]", relations: "[...]" } (stringified JSON).
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;

  const out: Record<string, unknown> = { ...obj };
  for (const key of ["entities", "relations"] as const) {
    const v = out[key];
    if (typeof v === "string") {
      try {
        out[key] = JSON.parse(v);
      } catch {
        // leave as-is
      }
    }
  }

  return out;
}

export async function extractFromChunk(opts: {
  chunkText: string;
}): Promise<{ output: ExtractionOutput; model: string; promptVersion: string }> {
  const prompt = buildExtractionPrompt({ chunkText: opts.chunkText });

  let output: ExtractionOutput;
  try {
    const res = await generateText({
      model: getExtractionModel(),
      prompt,
      // Some models/providers (e.g. OpenAI reasoning) don't support temperature.
      // Leaving it unset avoids noisy warnings while keeping deterministic-ish behavior via the prompt.
      output: Output.object({ schema: extractionOutputSchema }),
    });

    output = res.output as ExtractionOutput;
  } catch (err) {
    // Fallback: some providers/models return almost-correct JSON that fails strict schema coercion.
    // The AI SDK error often includes `text` with the raw model output.
    const anyErr = err as { text?: string; message?: string };
    const rawText = anyErr?.text;
    if (!rawText) throw err;

    const parsed = tryParseJson(rawText);
    const coerced = coerceExtractionShape(parsed);
    const validated = z.safeParse(extractionOutputSchema, coerced);
    if (!validated.success) throw err;
    output = validated.data as ExtractionOutput;
  }

  const model =
    process.env.OPENAI_EXTRACTION_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-5.2";

  return { output, model, promptVersion: EXTRACTION_PROMPT_VERSION };
}


