export type EmbeddingResponse = {
  model: string;
  usage?: { prompt_tokens: number; total_tokens: number };
  data: Array<{ index: number; embedding: number[] }>;
};

type OpenAIErrorResponse = {
  error?: {
    message?: string;
    type?: string;
    code?: string;
    param?: string;
  };
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} environment variable.`);
  return value;
}

export function getEmbeddingModel(): string {
  return process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = requireEnv("OPENAI_API_KEY");
  const model = getEmbeddingModel();

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: texts,
    }),
  });

  const json = (await res.json()) as EmbeddingResponse & OpenAIErrorResponse;
  if (!res.ok) {
    const msg = json.error?.message || `OpenAI embeddings failed (${res.status})`;
    throw new Error(msg);
  }

  const ordered = [...json.data].sort((a, b) => a.index - b.index);
  return ordered.map((d) => d.embedding);
}


