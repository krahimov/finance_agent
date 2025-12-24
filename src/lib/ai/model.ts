import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";

export function getChatModel() {
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.2";
  return openai(model);
}

export function getExtractionModel() {
  const provider = (process.env.EXTRACTION_PROVIDER?.trim() || "anthropic")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

  if (provider === "anthropic") {
    // If Anthropic isn't configured, fall back to OpenAI so extraction doesn't hard-fail.
    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      const fallbackModel = process.env.OPENAI_EXTRACTION_MODEL?.trim() || "gpt-4o-mini";
      return openai(fallbackModel);
    }
    const model =
      process.env.ANTHROPIC_EXTRACTION_MODEL?.trim() || "claude-3-5-haiku-latest";
    return anthropic(model);
  }

  // Fallback: OpenAI extraction model. Prefer a fast model by default.
  const model =
    process.env.OPENAI_EXTRACTION_MODEL?.trim() || "gpt-4o-mini";
  return openai(model);
}


