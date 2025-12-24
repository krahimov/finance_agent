import z from "zod/v4";

export const extractedEntitySchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  identifiers: z.record(z.string(), z.unknown()).optional(),
  aliases: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const extractedRelationSchema = z.object({
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence: z
    .object({
      quote: z.string().min(1).optional(),
    })
    .optional(),
});

export const extractionOutputSchema = z.object({
  entities: z.array(extractedEntitySchema).default([]),
  relations: z.array(extractedRelationSchema).default([]),
});

export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;


