import { RenderedPage, StructuredCompanyData } from "../types.js";
import { extractLinkedInCompany, extractLinkedInPerson } from "./platforms/linkedin.js";
import { extractCrunchbase } from "./platforms/crunchbase.js";
import { extractCompanyWebsite } from "./platforms/company-website.js";
import { extractNews } from "./platforms/news.js";
import { extractReadability } from "./readability.js";
import { logger } from "../utils/logger.js";

/**
 * Route an extracted page to the correct platform-specific extractor
 * based on the URL pattern.
 */
export function extractFromPage(page: RenderedPage): StructuredCompanyData {
  const urlLower = page.url.toLowerCase();

  if (urlLower.includes("linkedin.com/company")) {
    return extractLinkedInCompany(page);
  }
  if (urlLower.includes("linkedin.com/in")) {
    return extractLinkedInPerson(page);
  }
  if (urlLower.includes("crunchbase.com/organization") || urlLower.includes("crunchbase.com/company")) {
    return extractCrunchbase(page);
  }
  if (
    urlLower.includes("/team") ||
    urlLower.includes("/leadership") ||
    urlLower.includes("/about") ||
    urlLower.includes("/management") ||
    urlLower.includes("/board")
  ) {
    return extractCompanyWebsite(page);
  }
  if (urlLower.includes("news") || urlLower.includes("press") || urlLower.includes("article")) {
    return extractNews(page);
  }

  // For regular company homepages, use the company website extractor
  // (which handles schema.org JSON-LD and meta tags)
  if (!urlLower.includes("linkedin") && !urlLower.includes("crunchbase")) {
    // Quick check: does it look like a company page?
    const text = page.text.toLowerCase();
    const companySignals = ["about us", "our team", "services", "solutions", "products"];
    const isCompanyPage = companySignals.some((s) => text.includes(s));
    if (isCompanyPage || page.url.match(/^https?:\/\/[^/]+\/?$/)) {
      return extractCompanyWebsite(page);
    }
  }

  return extractReadability(page);
}

/**
 * Merge multiple StructuredCompanyData into one consolidated view.
 */
export function mergeExtractedData(allData: StructuredCompanyData[]): StructuredCompanyData {
  if (allData.length === 0) {
    return {
      source: "",
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
      rawText: "",
    };
  }
  if (allData.length === 1) return allData[0];

  const first = allData[0];
  const merged: StructuredCompanyData = {
    source: allData.map((d) => d.source).join(", "),
    sourceType: "unknown",
    companyName: first.companyName,
    industry: first.industry,
    companySize: first.companySize,
    founded: first.founded,
    headquarters: first.headquarters,
    description: first.description,
    specialties: [...first.specialties],
    website: first.website,
    people: [...first.people],
    departments: [...first.departments],
    locations: [...first.locations],
    funding: first.funding,
    rawText: first.rawText,
  };

  // Deduplicate people by name
  const seenPeople = new Map<string, StructuredCompanyData["people"][0]>();
  const seenDepts = new Map<string, StructuredCompanyData["departments"][0]>();

  for (const data of allData) {
    // Fill in missing top-level info from later sources
    for (const key of ["companyName", "industry", "companySize", "founded", "headquarters", "description", "website"] as const) {
      const val = data[key];
      if (!merged[key] && val !== null && val !== undefined) {
        (merged as any)[key] = val;
      }
    }
    for (const spec of data.specialties) {
      if (!merged.specialties.includes(spec)) merged.specialties.push(spec);
    }
    for (const person of data.people) {
      if (person.name) {
        const existing = seenPeople.get(person.name.toLowerCase());
        if (!existing || person.confidence === "direct") {
          seenPeople.set(person.name.toLowerCase(), person);
        }
      }
    }
    for (const dept of data.departments) {
      if (!seenDepts.has(dept.name.toLowerCase())) {
        seenDepts.set(dept.name.toLowerCase(), dept);
      }
    }
    if (!merged.funding && data.funding) {
      merged.funding = data.funding;
    }
  }

  merged.people = [...seenPeople.values()];
  merged.departments = [...seenDepts.values()];
  merged.rawText = allData.map((d) => `=== ${d.sourceType}: ${d.source} ===\n${d.rawText}`).join("\n\n");

  logger.info({ sources: allData.map((d) => d.sourceType), peopleCount: merged.people.length }, "extraction merge complete");
  return merged;
}
