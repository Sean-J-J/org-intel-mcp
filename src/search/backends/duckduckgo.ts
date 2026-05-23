import * as cheerio from "cheerio";
import { getConfig } from "../../config.js";
import { SearchResult } from "../../types.js";
import { SearchBackend } from "../types.js";
import { logger } from "../../utils/logger.js";

export class DuckDuckGoBackend implements SearchBackend {
  readonly name = "duckduckgo";
  readonly priority = 4;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async search(query: string, numResults: number): Promise<SearchResult[]> {
    const config = getConfig().search;
    logger.debug({ query }, "duckduckgo search (last resort)");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const encoded = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
      const resp = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        signal: controller.signal,
      });

      if (!resp.ok) return [];

      const html = await resp.text();
      const $ = cheerio.load(html);
      const results: SearchResult[] = [];

      $(".result").each((_i, el) => {
        const titleEl = $(el).find(".result__title a");
        const snippetEl = $(el).find(".result__snippet");
        const title = titleEl.text().trim();
        const href = titleEl.attr("href");
        const snippet = snippetEl.text().trim();

        if (title && href) {
          const match = href.match(/uddg=(https?%3A[^&]+)/);
          const actualUrl = match ? decodeURIComponent(match[1]) : href;
          results.push({ title, url: actualUrl, snippet, source: "duckduckgo" });
        }
      });

      logger.info({ query, count: results.length }, "duckduckgo search completed");
      return results.slice(0, numResults);
    } catch (err: any) {
      if (err.name === "AbortError") {
        logger.warn({ query }, "duckduckgo search timed out");
      }
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
