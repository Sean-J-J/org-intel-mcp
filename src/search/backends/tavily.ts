import { getConfig } from "../../config.js";
import { SearchResult } from "../../types.js";
import { SearchBackend } from "../types.js";
import { logger } from "../../utils/logger.js";
import { cacheGet, cacheSet } from "../../utils/cache.js";

const TAVILY_API = "https://api.tavily.com/search";

export class TavilyBackend implements SearchBackend {
  readonly name = "tavily";
  readonly priority = 1;

  async isAvailable(): Promise<boolean> {
    const key = getConfig().search.tavilyApiKey;
    return !!key;
  }

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    const config = getConfig().search;
    const apiKey = config.tavilyApiKey;
    if (!apiKey) throw new Error("Tavily API key not configured");

    const cacheId = `tavily:${query}:${numResults}`;
    const cached = cacheGet<SearchResult[]>(cacheId);
    if (cached) return cached;

    logger.debug({ query, numResults }, "tavily search");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const resp = await fetch(TAVILY_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: numResults,
          search_depth: "advanced",
          include_answer: false,
          include_raw_content: false,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "unknown");
        throw new Error(`Tavily returned ${resp.status}: ${errText.slice(0, 300)}`);
      }

      const data = await resp.json();
      const results: SearchResult[] = (data.results || []).map((r: any) => ({
        title: r.title || "",
        url: r.url || "",
        snippet: r.content || r.snippet || "",
        source: "tavily",
      }));

      cacheSet(cacheId, results);
      logger.info({ query, count: results.length }, "tavily search completed");
      return results;
    } catch (err: any) {
      if (err.name === "AbortError") throw new Error("Tavily search timed out");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
