/**
 * Rough token count estimation: ~4 characters per token for English text.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text at paragraph boundaries, keeping chunks under maxTokens.
 */
export function chunkText(text: string, maxTokens: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (estimateTokenCount(candidate) > maxTokens && current) {
      chunks.push(current);
      current = para;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Allocate a context budget across multiple text sources.
 * Priority sources get more budget. Returns truncated texts that fit within total budget.
 */
export function allocateContextBudget(
  sources: Array<{ key: string; text: string; priority: number }>,
  totalBudgetTokens: number
): Array<{ key: string; text: string }> {
  const sorted = [...sources].sort((a, b) => b.priority - a.priority);
  const results: Array<{ key: string; text: string }> = [];
  let remaining = totalBudgetTokens;

  for (const src of sorted) {
    if (remaining <= 0) break;
    const tokens = estimateTokenCount(src.text);
    if (tokens <= remaining) {
      results.push({ key: src.key, text: src.text });
      remaining -= tokens;
    } else {
      const maxChars = remaining * 4;
      results.push({ key: src.key, text: src.text.slice(0, maxChars) + "\n[...truncated]" });
      remaining = 0;
    }
  }

  return results.sort((a, b) => sources.findIndex((s) => s.key === a.key) - sources.findIndex((s) => s.key === b.key));
}

/**
 * Extract JSON from an LLM response that may include markdown code blocks.
 */
export function extractJsonFromResponse(text: string): string {
  // Try to find JSON in ```json blocks first
  const jsonBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonBlock) return jsonBlock[1].trim();

  // Try to find the first { and last }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text.trim();
}
