import * as cheerio from "cheerio";

export interface ScrapedPage {
  url: string;
  title: string;
  text: string;
  links: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Fetch a URL and parse it into structured content.
 */
export async function fetchPage(url: string, timeoutMs = 15000): Promise<ScrapedPage | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    clearTimeout(timer);

    if (!resp.ok) return null;

    const html = await resp.text();
    const $ = cheerio.load(html);

    // Remove scripts, styles, nav, footer
    $("script, style, nav, footer, header, noscript, svg").remove();

    const title = $("title").text().trim();
    const text = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000); // Limit text size

    // Extract relevant links
    const links: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        try {
          const fullUrl = new URL(href, url).toString();
          links.push(fullUrl);
        } catch {}
      }
    });

    return { url, title, text, links };
  } catch {
    return null;
  }
}

/**
 * Perform a web search using Google Custom Search (requires API key in env) OR
 * fallback to fetching search results from a public search engine.
 *
 * Currently uses a simple approach: queries Google via direct URL fetch.
 * This is a best-effort search — for production, SerpAPI or Google Custom Search is recommended.
 */
export async function webSearch(query: string, numResults = 5): Promise<SearchResult[]> {
  // Strategy: Use DuckDuckGo's lite/html version which doesn't require JS
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
    const page = await fetchPage(url);
    if (!page || !page.text) return [];

    const $ = cheerio.load(page.text);
    const results: SearchResult[] = [];

    $(".result").each((_, el) => {
      const titleEl = $(el).find(".result__title a");
      const snippetEl = $(el).find(".result__snippet");
      const title = titleEl.text().trim();
      const href = titleEl.attr("href");
      const snippet = snippetEl.text().trim();

      if (title && href) {
        // Extract actual URL from DuckDuckGo redirect
        const match = href.match(/uddg=(https?%3A[^&]+)/);
        const actualUrl = match ? decodeURIComponent(match[1]) : href;
        results.push({ title, url: actualUrl, snippet });
      }
    });

    return results.slice(0, numResults);
  } catch {
    return [];
  }
}

/**
 * Search specifically for company information across multiple platforms.
 * Returns a map of source -> content.
 */
export async function searchCompanyInfo(companyName: string): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  const searches = [
    { key: "company", query: `${companyName} company about` },
    { key: "linkedin", query: `site:linkedin.com/company ${companyName}` },
    { key: "crunchbase", query: `site:crunchbase.com ${companyName}` },
    { key: "leadership", query: `${companyName} leadership team org chart` },
    { key: "jobs", query: `site:linkedin.com/jobs ${companyName}` },
    { key: "news", query: `${companyName} company news organization` },
  ];

  const promises = searches.map(async (s) => {
    const searchResults = await webSearch(s.query, 3);
    for (const r of searchResults) {
      const page = await fetchPage(r.url);
      if (page && page.text.length > 200) {
        results[s.key] = (results[s.key] || "") + `\n=== From: ${r.url} ===\n${page.text}\n`;
        break; // One good result per search is enough
      }
    }
  });

  await Promise.all(promises);

  // Also try fetching the company website directly
  let domainName = companyName.toLowerCase().replace(/[^a-z0-9.-]/g, "");
  // Remove common suffixes that aren't part of the domain name
  domainName = domainName.replace(/\.?(inc|corp|ltd|limited|llc|gmbh|sa|bv|nv|plc)\.?$/i, "");
  domainName = domainName.replace(/^(the|inc|corp)\.?/i, "");
  const possibleDomains = [
    `https://${domainName}.com`,
    `https://${domainName}.io`,
    `https://${domainName}.ai`,
    `https://www.${domainName}.com`,
    `https://www.${domainName}.io`,
    `https://www.${domainName}.ai`,
  ];

  for (const domain of possibleDomains) {
    const page = await fetchPage(domain);
    if (page && page.text.length > 200) {
      results["website"] = (results["website"] || "") + `\n=== From: ${domain} ===\n${page.text}\n`;
      break;
    }
  }

  // Also try finding the team/leadership page on the company website
  if (results["website"]) {
    const baseUrlMatch = results["website"].match(/=== From: (https?:\/\/[^\/\s]+)/);
    if (baseUrlMatch) {
      const base = baseUrlMatch[1];
      const teamPagePaths = ["/team", "/about-us", "/leadership", "/company/leadership", "/management-team", "/about/leadership"];
      for (const path of teamPagePaths) {
        const page = await fetchPage(`${base}${path}`);
        if (page && page.text.length > 300) {
          results["team_page"] = `\n=== From: ${base}${path} ===\n${page.text}\n`;
          break;
        }
      }
    }
  }

  return results;
}
