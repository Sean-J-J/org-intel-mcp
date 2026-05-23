import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { RenderedPage, StructuredCompanyData } from "../types.js";
import { logger } from "../utils/logger.js";

/**
 * Generic extractor using Mozilla's Readability algorithm.
 * Strips navigation, sidebars, ads, and extracts main article content.
 */
export function extractReadability(page: RenderedPage): StructuredCompanyData {
  try {
    const dom = new JSDOM(page.html, { url: page.url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    const data: StructuredCompanyData = {
      source: page.url,
      sourceType: "unknown",
      companyName: null,
      industry: null,
      companySize: null,
      founded: null,
      headquarters: null,
      description: article?.excerpt || null,
      specialties: [],
      website: null,
      people: [],
      departments: [],
      locations: [],
      funding: null,
      rawText: article?.textContent?.replace(/\s+/g, " ").trim().slice(0, 8000) || page.text,
    };

    if (article?.title) {
      data.companyName = article.title.split("|")[0].split("-")[0].trim();
    }

    logger.info({ url: page.url, textLen: data.rawText.length }, "readability extraction complete");
    return data;
  } catch (err: any) {
    logger.warn({ url: page.url, error: err.message }, "readability failed, using raw text");
    return {
      source: page.url,
      sourceType: "unknown",
      companyName: null,
      industry: null,
      companySize: null,
      founded: null,
      headquarters: null,
      description: null,
      specialties: [],
      website: null,
      people: [],
      departments: [],
      locations: [],
      funding: null,
      rawText: page.text,
    };
  }
}
