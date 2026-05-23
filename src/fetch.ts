import { RenderedPage } from "./types.js";
import { renderPage } from "./browser/renderer.js";
import { logger } from "./utils/logger.js";
import { cacheGet, cacheSet } from "./utils/cache.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Fetch a URL using plain HTTP (static HTML).
 * Returns the parsed page with cheerio-style text extraction.
 */
export async function fetchPage(url: string, timeoutMs = 15000): Promise<RenderedPage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    clearTimeout(timer);

    if (!resp.ok) return null;

    const html = await resp.text();
    const text = extractTextFromHtml(html);

    // Extract links
    const links: string[] = [];
    const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>/gi;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(html)) !== null) {
      const href = linkMatch[1];
      if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        try {
          links.push(new URL(href, url).toString());
        } catch {
          // invalid URL, skip
        }
      }
    }

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    return { url, title, html, text, links, renderMethod: "http" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractTextFromHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-zA-Z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10000);
}

/**
 * Smart fetch: tries HTTP first. If the result looks like an SPA shell
 * (very little text content), upgrades to Playwright rendering.
 */
export async function smartFetch(url: string): Promise<RenderedPage | null> {
  const cacheId = `fetch:${url}`;
  const cached = cacheGet<RenderedPage>(cacheId);
  if (cached) return cached;

  logger.debug({ url }, "smart fetch");

  // Try HTTP first
  const httpPage = await fetchPage(url);

  // If HTTP succeeds with substantial content, use it
  if (httpPage && httpPage.text.length >= 500) {
    cacheSet(cacheId, httpPage);
    return httpPage;
  }

  // HTTP returned empty/minimal content — likely an SPA, use Playwright
  if (httpPage && httpPage.text.length < 500) {
    logger.debug({ url, httpTextLen: httpPage.text.length }, "SPA detected, upgrading to Playwright");
  }

  try {
    const renderedPage = await renderPage(url);
    if (renderedPage) {
      cacheSet(cacheId, renderedPage);
      return renderedPage;
    }
  } catch (err: any) {
    logger.warn({ url, error: err.message }, "Playwright render failed");
  }

  // Fallback to whatever HTTP gave us (even if sparse)
  if (httpPage) {
    cacheSet(cacheId, httpPage);
    return httpPage;
  }

  return null;
}
