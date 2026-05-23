import { getConfig } from "../../config.js";
import { SearchResult } from "../../types.js";
import { SearchBackend } from "../types.js";
import { logger } from "../../utils/logger.js";
import { cacheGet, cacheSet } from "../../utils/cache.js";

const DEFAULT_INSTANCES = [
  "https://searx.be",
  "https://search.sapti.me",
  "https://searx.tuxcloud.net",
  "https://searx.fmac.xyz",
  "https://search.canine.tools",
];

export class SearXNGBackend implements SearchBackend {
  readonly name = "searxng";
  readonly priority = 3;

  private getInstances(): string[] {
    const configured = getConfig().search.searxngInstances;
    return configured.length > 0 ? configured : DEFAULT_INSTANCES;
  }

  async isAvailable(): Promise<boolean> {
    return true; // always attempt, instances checked at query time
  }

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    const config = getConfig().search;
    const cacheId = `searxng:${query}:${numResults}`;
    const cached = cacheGet<SearchResult[]>(cacheId);
    if (cached) return cached;

    const instances = this.getInstances();
    logger.debug({ query, instances: instances.length }, "searxng search");

    // Shuffle instances to spread load
    const shuffled = [...instances].sort(() => Math.random() - 0.5);

    for (const instance of shuffled) {
      try {
        const results = await this.tryInstance(instance, query, numResults, config.timeoutMs);
        if (results.length > 0) {
          cacheSet(cacheId, results);
          logger.info({ query, instance, count: results.length }, "searxng search completed");
          return results;
        }
      } catch (err: any) {
        logger.debug({ instance, error: err.message }, "searxng instance failed");
      }
    }

    throw new Error("All SearXNG instances failed");
  }

  private async tryInstance(
    instance: string,
    query: string,
    numResults: number,
    timeoutMs: number
  ): Promise<SearchResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en`;
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OrgIntelMCP/2.0)" },
        signal: controller.signal,
      });

      if (!resp.ok) return [];

      const data = await resp.json();
      const results: SearchResult[] = (data.results || [])
        .slice(0, numResults)
        .map((r: any) => ({
          title: r.title || "",
          url: r.url || "",
          snippet: r.content || r.snippet || "",
          source: `searxng:${new URL(instance).hostname}`,
        }));

      return results;
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
