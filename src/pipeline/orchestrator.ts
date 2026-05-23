import { ResearchOptions } from "../types.js";
import { getPhaseConfig } from "../config.js";
import { SearchOrchestrator } from "../search/orchestrator.js";
import { buildTargetedLinkedInQueries } from "../search/query-builder.js";
import {
  searchLinkedInPeople,
  linkedInProfilesToExtractedPeople,
  linkedInProfilesToSearchResults,
} from "../search/linkedin-people-search.js";
import { smartFetch } from "../fetch.js";
import { resolveDomain } from "../discovery/domain-resolver.js";
import { extractFromPage, mergeExtractedData } from "../extraction/orchestrator.js";
import { extractEntities } from "../intelligence/analyzers/entity-extractor.js";
import { analyzeOrgStructure } from "../intelligence/analyzers/org-structure.js";
import { classifyDepartments } from "../intelligence/analyzers/department-classifier.js";
import { scoreConfidence } from "../intelligence/analyzers/confidence-scorer.js";
import { mapDecisionAuthority } from "../intelligence/analyzers/decision-mapper.js";
import { crossVerify } from "../intelligence/cross-verifier.js";
import { formatReport } from "./report-formatter.js";
import { logger } from "../utils/logger.js";
import { StructuredCompanyData, SearchResult, RenderedPage, VerifiedFindings } from "../types.js";

export async function researchCompany(options: ResearchOptions): Promise<string> {
  const { companyName, businessNeed, depth = "standard", onProgress } = options;
  const config = getPhaseConfig(depth);
  const searchOrch = new SearchOrchestrator();
  const startTime = Date.now();

  const progress = (phase: string, message: string) => {
    logger.info({ phase }, message);
    onProgress?.(phase, message);
  };

  logger.info({ companyName, businessNeed, depth }, "=== RESEARCH STARTED ===");

  try {
    // ============================================================
    // Phase 1: Discovery — search + domain resolution (parallel)
    // ============================================================
    progress("discovery", "Searching public web data for company information...");

    // Add targeted LinkedIn queries when business need is specific
    const extraLinkedInQueries = businessNeed
      ? buildTargetedLinkedInQueries(companyName, businessNeed)
      : [];
    if (extraLinkedInQueries.length > 0) {
      logger.info({ extraQueries: extraLinkedInQueries.length }, "adding business-need-targeted LinkedIn queries");
    }

    const [searchResults, domain, linkedInDirect] = await Promise.all([
      searchOrch.searchAll(companyName, config.maxSearches),
      resolveDomain(companyName, searchOrch),
      // Direct LinkedIn people search — only in deep mode with business need
      (depth === "deep" && businessNeed)
        ? searchLinkedInPeople(companyName, businessNeed).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Merge LinkedIn direct results into search results
    if (linkedInDirect?.profiles && linkedInDirect.profiles.length > 0) {
      const liResults = linkedInProfilesToSearchResults(linkedInDirect.profiles);
      const existing = searchResults.get("linkedin_direct") || [];
      searchResults.set("linkedin_direct", [...existing, ...liResults]);
      logger.info({ linkedInProfiles: linkedInDirect.profiles.length }, "LinkedIn direct profiles found");
    }

    // Add targeted LinkedIn queries to the existing search results map
    // These go through the same search engine backends
    if (extraLinkedInQueries.length > 0) {
      const extraResults = await Promise.all(
        extraLinkedInQueries.map(async (sq) => {
          try {
            const results = await searchOrch.search(sq.query, 5);
            return { key: sq.key, results };
          } catch {
            return { key: sq.key, results: [] };
          }
        })
      );
      for (const { key, results } of extraResults) {
        if (results.length > 0) {
          const existing = searchResults.get(key) || [];
          searchResults.set(key, [...existing, ...results]);
        }
      }
    }

    const totalHits = [...searchResults.values()].reduce((s, r) => s + r.length, 0);
    const sourcesFound = [...searchResults.keys()].join(", ");
    progress("discovery", `Discovery complete: ${totalHits} results from ${searchResults.size} sources (${sourcesFound})`);

    // ============================================================
    // Phase 2: Content Extraction
    // ============================================================
    progress("extraction", "Fetching and extracting content from web pages...");

    // Build URL list from search results, LinkedIn and Crunchbase first
    const priorityKeys = [
      "linkedin_company", "linkedin_leadership", "linkedin_officers",  // LinkedIn first
      "linkedin_direct", "linkedin_targeted_leaders", "linkedin_targeted_broad", "linkedin_targeted_heads", // Targeted LinkedIn
      "crunchbase",
      "domain", "wikipedia",
      "company_about", "leadership", "org_structure",
      "news",
    ];
    const urlsToFetch: string[] = [];
    const seenUrls = new Set<string>();
    for (const key of priorityKeys) {
      const results = searchResults.get(key) || [];
      for (const r of results) {
        if (!seenUrls.has(r.url)) {
          seenUrls.add(r.url);
          urlsToFetch.push(r.url);
        }
      }
    }

    // Add domain and its subpages if found
    if (domain && config.extraPages) {
      urlsToFetch.push(domain);
      const subPaths = ["/about", "/team", "/leadership", "/about-us", "/company", "/management"];
      for (const path of subPaths) {
        urlsToFetch.push(`${domain}${path}`);
      }
    }

    // Fetch all URLs (limited to prevent overload)
    const maxFetches = depth === "deep" ? 12 : depth === "standard" ? 8 : 4;
    const fetchTargets = urlsToFetch.slice(0, maxFetches);

    logger.info({ targetCount: fetchTargets.length }, "fetching pages");
    const pages = await Promise.all(
      fetchTargets.map((url) => smartFetch(url))
    );
    const validPages = pages.filter((p): p is NonNullable<typeof p> => p !== null);
    logger.info({ fetchedCount: validPages.length }, "pages fetched");

    // Extract structured data from each page
    const extractedData: StructuredCompanyData[] = validPages.map((page: RenderedPage) => extractFromPage(page));

    // Also include search snippets as additional data points
    const snippetData = buildSnippetData(searchResults, companyName);
    const linkedInDirectData = buildLinkedInDirectData(searchResults, companyName);
    const allData = [...extractedData, ...snippetData, ...linkedInDirectData];

    const merged = mergeExtractedData(allData);
    progress("extraction", `Extraction complete: ${merged.people.length} people, ${merged.departments.length} departments found`);

    // ============================================================
    // Phase 3: Intelligence Analysis
    // ============================================================
    progress("analysis", "AI analyzing entities and people...");

    // Pass 1: Entity Extraction
    const entities = await extractEntities(companyName, allData, depth);

    progress("analysis", "AI analyzing organizational structure...");

    // Pass 2: Org Structure Analysis
    const orgStructure = await analyzeOrgStructure(entities, companyName, depth);

    progress("analysis", "AI classifying departments...");

    // Pass 3: Department Classification
    const departments = await classifyDepartments(entities, orgStructure, companyName, depth);

    // Pass 4: Confidence Scoring
    const scoredFindings = await scoreConfidence(
      entities,
      orgStructure,
      departments,
      allData,
      companyName,
      depth
    );

    // Cross-verification
    let verifiedFindings: VerifiedFindings = { consensus: scoredFindings, discrepancies: [], summary: "Single source analysis" };
    if (config.crossVerify && allData.filter((d) => d.sourceType !== "search_snippet").length >= 2) {
      verifiedFindings = await crossVerify(scoredFindings, allData, companyName, depth);
    }

    // Decision Mapping (if business need provided)
    let decisionMap = null;
    if (businessNeed) {
      progress("analysis", "Mapping decision authority for business need...");
      decisionMap = await mapDecisionAuthority(
        companyName,
        businessNeed,
        verifiedFindings.consensus,
        allData,
        depth
      );
    }

    // ============================================================
    // Phase 4: Report Formatting
    // ============================================================
    const sourceSummary = allData
      .map((d) => `- ${d.sourceType}: ${d.source} (${d.people.length} people, ${d.departments.length} departments)`)
      .join("\n");

    const report = formatReport({
      companyName,
      businessNeed,
      depth,
      sourceSummary,
      entities,
      orgStructure,
      departments,
      verifiedFindings,
      decisionMap,
      sources: allData,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info({ elapsed: `${elapsed}s` }, "=== RESEARCH COMPLETE ===");

    return report;
  } catch (err: any) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.error({ error: err.message, elapsed: `${elapsed}s` }, "research failed");
    return `Error researching ${companyName}: ${err.message}. The research pipeline encountered an error after ${elapsed}s. Please try again or reduce depth.`;
  }
}

function buildSnippetData(
  searchResults: Map<string, SearchResult[]>,
  companyName: string
): StructuredCompanyData[] {
  const result: StructuredCompanyData[] = [];
  for (const [key, results] of searchResults) {
    for (const r of results) {
      if (r.snippet && r.snippet.length > 50) {
        result.push({
          source: r.url,
          sourceType: key === "linkedin_direct" ? "linkedin" : "search_snippet",
          companyName: null,
          industry: null,
          companySize: null,
          founded: null,
          headquarters: null,
          description: r.snippet,
          specialties: [],
          website: null,
          people: [],
          departments: [],
          locations: [],
          funding: null,
          rawText: `Title: ${r.title}\nSnippet: ${r.snippet}\nSearch type: ${key}`,
        });
      }
    }
  }
  return result;
}

/**
 * Convert LinkedIn direct search results into StructuredCompanyData.
 * Unlike search snippets, these contain verified people profiles with names and titles.
 */
function buildLinkedInDirectData(
  searchResults: Map<string, SearchResult[]>,
  companyName: string
): StructuredCompanyData[] {
  const results = searchResults.get("linkedin_direct") || [];
  if (results.length === 0) return [];

  // Parse people from the search result titles (format: "Name - Title")
  const people: Array<{ name: string; title: string; source: string }> = [];
  for (const r of results) {
    const parts = r.title.split(" - ");
    const name = parts[0]?.trim() || "";
    const title = parts.slice(1).join(" - ").trim() || "";
    if (name) {
      people.push({ name, title, source: r.url });
    }
  }

  if (people.length === 0) return [];

  return [
    {
      source: "linkedin_direct_search",
      sourceType: "linkedin",
      companyName,
      industry: null,
      companySize: null,
      founded: null,
      headquarters: null,
      description: `LinkedIn profiles found for ${companyName}: ${people.map((p) => `${p.name} (${p.title})`).join("; ")}`,
      specialties: [],
      website: null,
      people: people.map((p) => ({
        name: p.name,
        title: p.title,
        department: null,
        source: p.source,
        confidence: "direct" as const,
      })),
      departments: [],
      locations: [],
      funding: null,
      rawText: people.map((p) => `Name: ${p.name}\nTitle: ${p.title}\nProfile: ${p.source}`).join("\n\n"),
    },
  ];
}
