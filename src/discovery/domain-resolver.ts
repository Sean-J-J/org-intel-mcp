import { SearchOrchestrator } from "../search/orchestrator.js";
import { fetchPage } from "../fetch.js";
import { logger } from "../utils/logger.js";
import { cacheGet, cacheSet } from "../utils/cache.js";

/**
 * Search-based domain resolution. Instead of guessing .com/.io/.ai,
 * it searches for the company's official website and validates the result.
 */
export async function resolveDomain(companyName: string, searchOrch: SearchOrchestrator): Promise<string | null> {
  const cacheId = `domain:${companyName.toLowerCase()}`;
  const cached = cacheGet<string | null>(cacheId);
  if (cached !== null) return cached === "" ? null : cached;

  logger.info({ companyName }, "resolving domain via search");

  try {
    // Search for the company's official website
    const results = await searchOrch.search(`${companyName} official website homepage`, 5);
    const candidates: Array<{ domain: string; score: number }> = [];

    for (const result of results) {
      try {
        const url = new URL(result.url);
        const domain = url.hostname.replace(/^www\./, "");

        // Skip known non-company domains
        if (
          domain.match(/wikipedia\.org|linkedin\.com|crunchbase\.com|facebook\.com|twitter\.com|instagram\.com|youtube\.com|bloomberg\.com|reuters\.com/i)
        ) {
          continue;
        }

        // Fetch and score
        const page = await fetchPage(result.url);
        if (page && page.text.length > 200) {
          const score = scorePageRelevance(page.text, companyName, domain);
          if (score > 40) {
            candidates.push({ domain, score });
          }
          // If we got a strong match from search snippet alone, use it
          if (score > 70) break;
        }
      } catch {
        continue;
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    if (best) {
      logger.info({ companyName, domain: best.domain, score: best.score }, "domain resolved");
      cacheSet(cacheId, best.domain);
      return `https://${best.domain}`;
    }

    // Fallback: try common TLDs for the sanitized name
    const sanitized = sanitizeForDomain(companyName);
    const fallbackTlds = [".com", ".org", ".io", ".co", ".net", ".gov.sa", ".gov.ae", ".co.uk", ".de", ".fr"];
    for (const tld of fallbackTlds) {
      const testUrl = `https://www.${sanitized}${tld}`;
      const page = await fetchPage(testUrl);
      if (page && page.text.length > 300) {
        const score = scorePageRelevance(page.text, companyName, `${sanitized}${tld}`);
        if (score > 50) {
          logger.info({ companyName, domain: `${sanitized}${tld}`, method: "fallback" }, "domain resolved via fallback");
          cacheSet(cacheId, `${sanitized}${tld}`);
          return testUrl;
        }
      }
    }

    cacheSet(cacheId, "");
    return null;
  } catch (err: any) {
    logger.warn({ companyName, error: err.message }, "domain resolution failed");
    cacheSet(cacheId, "");
    return null;
  }
}

function sanitizeForDomain(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 30);
}

function scorePageRelevance(text: string, companyName: string, domain: string): number {
  let score = 0;
  const textLower = text.toLowerCase();
  const nameLower = companyName.toLowerCase();
  const nameWords = nameLower.split(/\s+/).filter((w) => w.length > 2);

  // +50: title contains company name
  if (textLower.includes(nameLower)) score += 50;

  // +30: most name words appear
  const matchedWords = nameWords.filter((w) => textLower.includes(w));
  score += (matchedWords.length / Math.max(nameWords.length, 1)) * 30;

  // +20: copyright/legal mentions match
  if (textLower.includes(`© ${companyName}`) || textLower.includes(`copyright ${companyName}`)) score += 20;

  // -100: clearly different company
  if (
    textLower.includes("wikipedia") ||
    textLower.includes("the free encyclopedia") ||
    textLower.includes("search results")
  ) {
    score -= 100;
  }

  return score;
}
