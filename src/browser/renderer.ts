import { getBrowserPool } from "./pool.js";
import { RenderedPage } from "../types.js";
import { logger } from "../utils/logger.js";
import { getConfig } from "../config.js";
import { createDomainRateLimiter } from "../utils/rate-limiter.js";

const rateLimiter = createDomainRateLimiter();

export interface RenderOptions {
  waitStrategy?: "networkidle" | "load" | "domcontentloaded";
  waitSelector?: string;
  scrollToLoad?: boolean;
  extractText: boolean;
}

/**
 * Platform-specific render strategies.
 */
function getStrategy(url: string): RenderOptions {
  const urlLower = url.toLowerCase();
  if (urlLower.includes("linkedin.com/in")) {
    return {
      waitStrategy: "networkidle",
      waitSelector: ".pv-top-card, .text-heading-xlarge, h1",
      scrollToLoad: true,
      extractText: true,
    };
  }
  if (urlLower.includes("linkedin.com/company")) {
    return {
      waitStrategy: "networkidle",
      waitSelector: ".org-top-card, .org-about-module, h1",
      scrollToLoad: true,
      extractText: true,
    };
  }
  if (urlLower.includes("crunchbase.com")) {
    return {
      waitStrategy: "networkidle",
      scrollToLoad: true,
      extractText: true,
    };
  }
  return {
    waitStrategy: "networkidle",
    scrollToLoad: false,
    extractText: true,
  };
}

/**
 * Render a JS-heavy page using Playwright and return structured content.
 * This is used when the HTTP fetcher returns empty/minimal content (SPA detection).
 */
export async function renderPage(
  url: string,
  options?: RenderOptions
): Promise<RenderedPage | null> {
  const config = getConfig().browser;
  const opts = options || getStrategy(url);

  // Respect per-domain rate limits
  try {
    const domain = new URL(url).hostname;
    await rateLimiter.acquire(domain);
  } catch {
    // if URL parsing fails, skip rate limiting
  }

  const pool = getBrowserPool();
  const page = await pool.getPage();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    logger.debug({ url }, "playwright rendering");

    await page.goto(url, {
      waitUntil: opts.waitStrategy || "domcontentloaded",
      timeout: config.timeoutMs,
    });

    // Wait for a specific selector if requested
    if (opts.waitSelector) {
      try {
        await page.waitForSelector(opts.waitSelector, { timeout: 8000, state: "attached" });
      } catch {
        // selector may not exist, continue
      }
    }

    // Scroll to load lazy content
    if (opts.scrollToLoad) {
      await page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          let totalHeight = 0;
          const distance = 400;
          const maxScrolls = 15;
          let scrolls = 0;
          const timer = setInterval(() => {
            window.scrollBy(0, distance);
            totalHeight += distance;
            scrolls++;
            if (scrolls >= maxScrolls || totalHeight >= document.body.scrollHeight) {
              clearInterval(timer);
              resolve();
            }
          }, 300);
        });
      });
      // Brief pause for content to render
      await page.waitForTimeout(1000);
    }

    const title = await page.title();
    const html = await page.content();

    // Extract text
    let text: string;
    if (opts.extractText) {
      text = await page.evaluate(() => {
        // Remove scripts, styles, and hidden elements
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("script, style, noscript, [aria-hidden='true']").forEach((el) => el.remove());
        return (clone.textContent || "").replace(/\s+/g, " ").trim().slice(0, 12000);
      });
    } else {
      text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").trim().slice(0, 12000);
    }

    // Extract links
    const links = await page.evaluate(() => {
      const anchors = document.querySelectorAll("a[href]");
      const result: string[] = [];
      anchors.forEach((a) => {
        const href = a.getAttribute("href");
        if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
          result.push(href);
        }
      });
      return result;
    });

    logger.info({ url, textLen: text.length, linksCount: links.length }, "playwright render complete");
    return { url, title, html, text, links, renderMethod: "playwright" };
  } catch (err: any) {
    if (err.name === "AbortError" || err.message?.includes("timeout")) {
      logger.warn({ url }, "playwright render timed out");
    } else {
      logger.error({ url, error: err.message }, "playwright render failed");
    }
    return null;
  } finally {
    clearTimeout(timer);
    pool.releasePage(page);
  }
}
