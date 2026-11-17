/** Rough token estimate (~4 characters per token for English). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Splits text into chunks small enough for the on-device model, preferring
 * paragraph breaks, then sentence ends, then a hard cut.
 */
export function splitIntoChunks(text: string, maxChars: number): string[] {
  const limit = Math.max(200, maxChars);
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = window.lastIndexOf('\n\n');
    if (cut < limit * 0.4) cut = window.lastIndexOf('\n');
    if (cut < limit * 0.4) {
      const sentence = [...window.matchAll(/[.!?]\s/g)].pop();
      cut = sentence ? sentence.index + 1 : -1;
    }
    if (cut < limit * 0.4) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) chunks.push(rest);
  return chunks.filter((c) => c.trim().length > 0);
}
