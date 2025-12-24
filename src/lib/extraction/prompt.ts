export const EXTRACTION_PROMPT_VERSION = "v1";

export function buildExtractionPrompt(opts: { chunkText: string }) {
  // Keep this prompt intentionally conservative to reduce hallucinations:
  // - Only extract relations strongly supported by the text.
  // - Prefer high-precision over high-recall for the MVP.
  return `Extract a concise set of entities and relationships from the following SEC filing text chunk.

Rules:
- Output MUST be valid JSON and MUST match the schema described below.
- Do NOT wrap arrays/objects as strings (e.g. entities must be an array, not a quoted string).
- Only extract facts you can directly support from this text.
- Use short, canonical entity names (e.g. "Apple", "Taiwan Semiconductor Manufacturing Company", "CHIPS Act").
- If uncertain, omit the entity/relation (do not guess).
- confidence is between 0 and 1.

Schema:
{
  "entities": [
    {
      "type": "company|instrument|sector|country|event|concept|indicator (best-effort)",
      "name": "string",
      "identifiers": { "string": "string|number|boolean" },
      "aliases": ["string"],
      "confidence": 0.0
    }
  ],
  "relations": [
    {
      "subject": "string (entity name)",
      "predicate": "BENEFITS_FROM|EXPOSED_TO|SUPPLIES_TO|IMPACTS (use one of these if possible)",
      "object": "string (entity name)",
      "confidence": 0.0,
      "evidence": { "quote": "short supporting quote from the text (optional)" }
    }
  ]
}

Text chunk:
${opts.chunkText}`;
}


