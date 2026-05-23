import { RenderedPage, StructuredCompanyData } from "../../types.js";
import { logger } from "../../utils/logger.js";

/**
 * Parse a company's own website (about, team, leadership pages).
 * Attempts to extract structured data from schema.org JSON-LD as well as text patterns.
 */
export function extractCompanyWebsite(page: RenderedPage): StructuredCompanyData {
  const data: StructuredCompanyData = {
    source: page.url,
    sourceType: "website",
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

  try {
    const text = page.text;
    const html = page.html;

    // Try schema.org JSON-LD first (richest structured data)
    try {
      const ldMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
      if (ldMatch) {
        for (const match of ldMatch) {
          const jsonStr = match.replace(/<[^>]*>/g, "").replace(/^[^{]*/, "").replace(/[^}]*$/, "");
          try {
            const ld = JSON.parse(jsonStr);
            if (ld["@type"] === "Organization" || ld["@type"] === "Corporation" || ld["@type"] === "Company") {
              if (ld.name) data.companyName = ld.name;
              if (ld.description) data.description = ld.description;
              if (ld.url) data.website = ld.url;
              if (ld.foundingDate) data.founded = parseInt(ld.foundingDate.slice(0, 4), 10);
              if (ld.address) {
                const addr = ld.address;
                data.headquarters = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
                  .filter(Boolean).join(", ");
              }
              if (ld.numberOfEmployees) data.companySize = String(ld.numberOfEmployees);
            }
            if (ld["@type"] === "Person") {
              data.people.push({
                name: ld.name || null,
                title: ld.jobTitle || null,
                department: ld.department?.name || null,
                source: page.url,
                confidence: "direct",
              });
            }
          } catch { /* JSON parse error, skip */ }
        }
      }
    } catch { /* ignore JSON-LD errors */ }

    // Extract from meta tags
    const metaPatterns: Record<string, RegExp> = {
      description: /<meta\s+name="description"\s+content="([^"]+)"/i,
      ogTitle: /<meta\s+property="og:title"\s+content="([^"]+)"/i,
      ogDescription: /<meta\s+property="og:description"\s+content="([^"]+)"/i,
      ogSiteName: /<meta\s+property="og:site_name"\s+content="([^"]+)"/i,
    };
    for (const [key, regex] of Object.entries(metaPatterns)) {
      const m = html.match(regex);
      if (m) {
        if (key === "ogTitle" && !data.companyName) {
          data.companyName = m[1].trim().split("|")[0].split("-")[0].trim();
        }
        if ((key === "description" || key === "ogDescription") && !data.description) {
          data.description = m[1].trim();
        }
        if (key === "ogSiteName" && !data.companyName) {
          data.companyName = m[1].trim();
        }
      }
    }

    // Extract from visible text
    if (!data.companyName) {
      const h1Match = text.match(/^(?!.*(?:menu|search|login|sign|cart))([A-Z][A-Za-z0-9\s&.-]{3,50})\s*$/m);
      if (h1Match) data.companyName = h1Match[1].trim();
    }

    // Extract people from team/leadership/about pages
    if (page.url.match(/\/(team|leadership|about|people|management|board)/i)) {
      extractPeopleFromText(text, page.url, data.people);
    }

    // Detect departments from team structure mentions
    const deptRegex = /\b(Engineering|Sales|Marketing|Product|Finance|HR|Human Resources|Legal|Operations|IT|Research|Customer)\s+(?:Department|Team|Division|Group)/gi;
    let deptMatch;
    while ((deptMatch = deptRegex.exec(text)) !== null) {
      const deptName = deptMatch[1];
      if (!data.departments.find((d) => d.name.toLowerCase() === deptName.toLowerCase())) {
        data.departments.push({
          name: deptName,
          headName: null,
          headTitle: null,
          teamSize: null,
          confidence: "direct",
        });
      }
    }

    logger.info({ url: page.url, peopleCount: data.people.length }, "company website extraction complete");
  } catch (err: any) {
    logger.warn({ url: page.url, error: err.message }, "company website extraction error");
  }

  return data;
}

function extractPeopleFromText(text: string, source: string, people: StructuredCompanyData["people"]): void {
  // Pattern: "Name Surname, Title" or "Name Surname - Title" in the context of team listings
  const pattern = /([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\s*[-–,]\s*(.{5,80}?)(?:\n|$)/gm;
  let match;
  const seenNames = new Set<string>();
  while ((match = pattern.exec(text)) !== null) {
    const name = match[1].trim();
    const title = match[2].trim();
    if (
      name.length > 5 &&
      name.length < 50 &&
      !seenNames.has(name.toLowerCase()) &&
      !title.match(/^\d/) &&
      title.length > 8
    ) {
      seenNames.add(name.toLowerCase());
      people.push({ name, title, department: null, source, confidence: "direct" });
    }
  }
}
