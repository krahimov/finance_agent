export type TextChunk = {
  index: number;
  text: string;
  startChar: number;
  endChar: number;
};

export function chunkTextByChars(
  text: string,
  opts?: { chunkSize?: number; overlap?: number },
): TextChunk[] {
  const chunkSize = opts?.chunkSize ?? 2200;
  const overlap = opts?.overlap ?? 200;

  if (chunkSize <= 0) throw new Error("chunkSize must be > 0");
  if (overlap < 0) throw new Error("overlap must be >= 0");
  if (overlap >= chunkSize) throw new Error("overlap must be < chunkSize");

  const chunks: TextChunk[] = [];
  let start = 0;
  let idx = 0;

  while (start < text.length) {
    const end = Math.min(text.length, start + chunkSize);
    const slice = text.slice(start, end).trim();
    if (slice.length > 0) {
      chunks.push({
        index: idx,
        text: slice,
        startChar: start,
        endChar: end,
      });
      idx += 1;
    }

    if (end === text.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}


