/**
 * LinkedIn People Search Module
 *
 * Directly searches LinkedIn for people profiles matching a company and
 * business need. Uses Playwright with a persistent browser profile to
 * maintain login state across invocations.
 *
 * Falls back gracefully if Playwright isn't available, the browser can't
 * launch, or LinkedIn blocks the request.
 */
import { SearchResult, ExtractedPerson } from "../types.js";
import { logger } from "../utils/logger.js";
import { getConfig } from "../config.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const PROFILE_DIR = path.join(PROJECT_ROOT, ".linkedin-profile");

export interface LinkedInProfile {
  name: string;
  title: string;
  profileUrl: string;
  snippet: string;
}

export interface LinkedInSearchResult {
  profiles: LinkedInProfile[];
  searchUrl: string;
  error?: string;
}

/**
 * Build targeted LinkedIn people search queries from business need.
 */
function buildQueries(companyName: string, businessNeed?: string): string[] {
  const base = companyName.replace(/["']/g, "");
  const queries: string[] = [];

  if (businessNeed) {
    // Extract keywords from business need (2-4 most important words)
    const keywords = businessNeed
      .toLowerCase()
      .split(/[\s,;|/]+/)
      .filter((w) => w.length > 3 && !["with", "from", "that", "this", "about", "their"].includes(w))
      .slice(0, 4);

    if (keywords.length >= 1) {
      queries.push(`${base} ${keywords.slice(0, 2).join(" ")}`);
    }
    if (keywords.length >= 3) {
      queries.push(`${base} ${keywords.slice(2, 4).join(" ")}`);
    }

    // Add a leadership-targeted query
    queries.push(`${base} director head ${keywords.slice(0, 2).join(" ")}`);
  } else {
    queries.push(`${base} leadership`);
    queries.push(`${base} director`);
  }

  return queries;
}

/**
 * Attempt to search LinkedIn for people matching the company and business need.
 * Returns profiles or null if LinkedIn search is unavailable.
 */
export async function searchLinkedInPeople(
  companyName: string,
  businessNeed?: string
): Promise<LinkedInSearchResult | null> {
  let playwright: any;
  try {
    playwright = await import("playwright");
  } catch {
    logger.warn("Playwright not available, skipping LinkedIn direct search");
    return null;
  }

  const config = getConfig();
  const queries = buildQueries(companyName, businessNeed);
  const allProfiles: LinkedInProfile[] = [];
  const searchedUrls: string[] = [];

  let context: any = null;

  try {
    // Use persistent context to reuse login session
    const headless = config.browser.headless;

    // Quick check: persistent profile exists and has cookies?
    const cookiesPath = path.join(PROFILE_DIR, "Default", "Cookies");
    const hasProfile = fs.existsSync(cookiesPath);

    logger.info({ headless, hasProfile, profileDir: PROFILE_DIR }, "launching LinkedIn browser");

    context = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
      channel: "chrome",
      headless,
      viewport: { width: 1280, height: 900 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });

    const page = context.pages()[0] || await context.newPage();

    // Quick login check
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    }).catch(() => {});

    await page.waitForTimeout(2000);

    if (page.url().includes("login")) {
      logger.warn("LinkedIn not logged in — session expired or first run. Run linkedin-sama-scraper.cjs manually first.");
      await context.close().catch(() => {});
      return { profiles: [], searchUrl: "", error: "Not logged in to LinkedIn. Run manual login script first." };
    }

    // Execute searches (max 3 to keep it fast)
    for (let i = 0; i < Math.min(queries.length, 3); i++) {
      const query = queries[i];
      const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
      searchedUrls.push(searchUrl);

      logger.info({ query }, `LinkedIn search ${i + 1}/${Math.min(queries.length, 3)}`);

      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(3000);

        const profiles: LinkedInProfile[] = await page.evaluate(() => {
          const links = document.querySelectorAll('a[href*="/in/"]');
          const seen = new Set<string>();
          const result: Array<{ name: string; title: string; profileUrl: string; snippet: string }> = [];

          links.forEach((a: any) => {
            const href = a.href.replace(/\?.*$/, "");
            if (seen.has(href)) return;
            seen.add(href);
            const rawText = (a.innerText || "").trim();
            if (rawText.length < 3) return;

            const lines = rawText.split("\n").map((s: string) => s.trim()).filter(Boolean);
            const name = lines[0]?.replace(/•.*$/, "").trim() || "";
            const title = lines[1] || "";

            if (name.length > 1) {
              result.push({
                name,
                title,
                profileUrl: href,
                snippet: rawText.slice(0, 200),
              });
            }
          });
          return result;
        });

        allProfiles.push(...profiles);
        logger.info({ query, found: profiles.length }, "LinkedIn search result");
      } catch (err: any) {
        logger.warn({ query, error: err.message }, "LinkedIn search failed for query");
      }

      if (i < Math.min(queries.length, 3) - 1) {
        await page.waitForTimeout(1000);
      }
    }

    await context.close().catch(() => {});
  } catch (err: any) {
    logger.error({ error: err.message }, "LinkedIn direct search failed");
    if (context) await context.close().catch(() => {});
    return { profiles: [], searchUrl: searchedUrls[0] || "", error: err.message };
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = allProfiles.filter((p) => {
    if (seen.has(p.profileUrl)) return false;
    seen.add(p.profileUrl);
    return true;
  });

  logger.info({ totalProfiles: unique.length, queries: searchedUrls.length }, "LinkedIn direct search complete");

  return {
    profiles: unique,
    searchUrl: searchedUrls[0] || "",
  };
}

/**
 * Convert LinkedIn search results to the standard ExtractedPerson format
 * used by the MCP pipeline.
 */
export function linkedInProfilesToExtractedPeople(
  profiles: LinkedInProfile[]
): ExtractedPerson[] {
  return profiles.map((p) => ({
    name: p.name || null,
    title: p.title || null,
    department: null,
    source: p.profileUrl,
    confidence: "direct" as const,
  }));
}

/**
 * Convert LinkedIn search results to SearchResult format so they can be
 * fetched and processed by the existing extraction pipeline.
 */
export function linkedInProfilesToSearchResults(
  profiles: LinkedInProfile[]
): SearchResult[] {
  return profiles.map((p) => ({
    title: `${p.name} - ${p.title}`,
    url: p.profileUrl,
    snippet: p.snippet || `${p.name}: ${p.title}`,
    source: "linkedin_direct",
  }));
}
