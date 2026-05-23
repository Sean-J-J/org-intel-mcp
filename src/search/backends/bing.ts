import { getConfig } from "../../config.js";
import { SearchResult } from "../../types.js";
import { SearchBackend } from "../types.js";
import { logger } from "../../utils/logger.js";
import { cacheGet, cacheSet } from "../../utils/cache.js";

const BING_API = "https://api.bing.microsoft.com/v7.0/search";

export class BingBackend implements SearchBackend {
  readonly name = "bing";
  readonly priority = 2;

  async isAvailable(): Promise<boolean> {
    const key = getConfig().search.bingApiKey;
    return !!key;
  }

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    const config = getConfig().search;
    const apiKey = config.bingApiKey;
    if (!apiKey) throw new Error("Bing API key not configured");

    const cacheId = `bing:${query}:${numResults}`;
    const cached = cacheGet<SearchResult[]>(cacheId);
    if (cached) return cached;

    logger.debug({ query, numResults }, "bing search");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const url = `${BING_API}?q=${encodeURIComponent(query)}&count=${numResults}&mkt=en-US`;
      const resp = await fetch(url, {
        headers: { "Ocp-Apim-Subscription-Key": apiKey },
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "unknown");
        throw new Error(`Bing returned ${resp.status}: ${errText.slice(0, 300)}`);
      }

      const data = await resp.json();
      const results: SearchResult[] = (data.webPages?.value || []).map((r: any) => ({
        title: r.name || "",
        url: r.url || "",
        snippet: r.snippet || "",
        source: "bing",
      }));

      cacheSet(cacheId, results);
      logger.info({ query, count: results.length }, "bing search completed");
      return results;
    } catch (err: any) {
      if (err.name === "AbortError") throw new Error("Bing search timed out");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
