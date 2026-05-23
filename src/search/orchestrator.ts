import { SearchResult, SearchQuery } from "../types.js";
import { SearchBackend } from "./types.js";
import { TavilyBackend } from "./backends/tavily.js";
import { BingBackend } from "./backends/bing.js";
import { SearXNGBackend } from "./backends/searxng.js";
import { DuckDuckGoBackend } from "./backends/duckduckgo.js";
import { buildSearchQueries } from "./query-builder.js";
import { logger } from "../utils/logger.js";
import { getConfig } from "../config.js";

const ALL_QUERIES = buildSearchQueries("");
const ALL_QUERY_KEYS = ALL_QUERIES.map((q) => q.key);

export class SearchOrchestrator {
  private backends: SearchBackend[];
  private availabilityCache: Map<string, { available: boolean; timestamp: number }> = new Map();

  constructor() {
    this.backends = [
      new TavilyBackend(),
      new BingBackend(),
      new SearXNGBackend(),
      new DuckDuckGoBackend(),
    ].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Select which queries to run based on depth. Returns the top N queries by priority,
   * wrapping company name into the query template.
   */
  getQueries(companyName: string, maxQueries: number): SearchQuery[] {
    const all = buildSearchQueries(companyName);
    return all.slice(0, Math.min(maxQueries, all.length));
  }

  /**
   * Run multiple searches in parallel, returning a map of key -> results.
   */
  async searchAll(
    companyName: string,
    maxQueries: number
  ): Promise<Map<string, SearchResult[]>> {
    const queries = this.getQueries(companyName, maxQueries);
    const results = new Map<string, SearchResult[]>();
    const config = getConfig().search;

    logger.info(
      { companyName, queryCount: queries.length, maxResults: config.maxResultsPerQuery },
      "starting parallel search"
    );

    const promises = queries.map(async (sq) => {
      try {
        const searchResults = await this.search(sq.query, config.maxResultsPerQuery);
        results.set(sq.key, searchResults);
      } catch (err: any) {
        logger.warn({ key: sq.key, error: err.message }, "search query failed");
        results.set(sq.key, []);
      }
    });

    await Promise.all(promises);

    const totalResults = [...results.values()].reduce((sum, r) => sum + r.length, 0);
    logger.info({ companyName, totalResults, queriesWithResults: [...results.values()].filter((r) => r.length > 0).length }, "search completed");

    return results;
  }

  /**
   * Run a single search through the failover chain.
   */
  async search(query: string, numResults: number): Promise<SearchResult[]> {
    for (const backend of this.backends) {
      const available = await this.checkAvailability(backend);
      if (!available) {
        logger.debug({ backend: backend.name }, "backend unavailable, skipping");
        continue;
      }

      try {
        const results = await backend.search(query, numResults);
        if (results.length > 0) {
          return results;
        }
        logger.debug({ backend: backend.name, query }, "backend returned 0 results, trying next");
      } catch (err: any) {
        logger.warn({ backend: backend.name, query: query.slice(0, 80), error: err.message }, "backend search failed");
        this.availabilityCache.set(backend.name, { available: false, timestamp: Date.now() });
      }
    }

    logger.warn({ query }, "all search backends exhausted, returning empty");
    return [];
  }

  private async checkAvailability(backend: SearchBackend): Promise<boolean> {
    const cached = this.availabilityCache.get(backend.name);
    if (cached) {
      const age = (Date.now() - cached.timestamp) / 1000;
      if (age < 60) return cached.available;
    }

    try {
      const available = await backend.isAvailable();
      this.availabilityCache.set(backend.name, { available, timestamp: Date.now() });
      return available;
    } catch {
      return false;
    }
  }
}
