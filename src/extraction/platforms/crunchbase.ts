import { RenderedPage, StructuredCompanyData } from "../../types.js";
import { logger } from "../../utils/logger.js";

export function extractCrunchbase(page: RenderedPage): StructuredCompanyData {
  const data: StructuredCompanyData = {
    source: page.url,
    sourceType: "crunchbase",
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

    // Company name
    const nameMatch = text.match(/(?:company|organization)\s*profile\s*[:•>\s]+([A-Z].{3,60}?)(?:\n|$)/i);
    if (!nameMatch) {
      const h1Match = text.match(/^([A-Z][A-Za-z0-9\s&.-]{3,50})\s*\n/m);
      if (h1Match) data.companyName = h1Match[1].trim();
    } else {
      data.companyName = nameMatch[1].trim();
    }

    // Description
    const descMatch = text.match(/description\s*[:•]\s*(.{100,2000}?)(?:\n\s*\n|\n[A-Z])/is);
    if (descMatch) data.description = descMatch[1].trim();
    if (!data.description) {
      const firstLong = text.match(/(.{200,2000}?)(?:\n\s*\n|\n[A-Z])/s);
      if (firstLong) data.description = firstLong[1].trim();
    }

    // Industry
    const industryMatch = text.match(/(?:industry|category|categories)\s*[:•]\s*(.{3,60}?)(?:\n)/i);
    if (industryMatch) data.industry = industryMatch[1].trim();
    if (data.industry) {
      data.specialties = data.industry.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
    }

    // Headquarters / location
    const hqMatch = text.match(/(?:headquarters|location|hq)\s*[:•]\s*(.{3,120}?)(?:\n)/i);
    if (hqMatch) data.headquarters = hqMatch[1].trim();

    // Founded
    const foundedMatch = text.match(/founded\s*[:•date]*\s*(\d{4})/i);
    if (foundedMatch) data.founded = parseInt(foundedMatch[1], 10);

    // Company size
    const sizeMatch = text.match(/(?:employees|company size|size)\s*[:•]\s*([\d,]+[+-]?\s*(?:employees|staff|members|people)?)/i);
    if (sizeMatch) data.companySize = sizeMatch[1].trim();

    // Website
    const websiteMatch = text.match(/website\s*[:•]\s*(https?:\/\/[^\s]+)/i);
    if (websiteMatch) data.website = websiteMatch[1].trim();

    // Funding information
    const totalRaisedMatch = text.match(/total funding\s*[:•amount]*\s*\$?([\d.]+[MBT]?)/i);
    const lastRoundMatch = text.match(/last funding\s*(?:round)?\s*type\s*[:•]\s*(.+?)(?:\n)/i);
    const investorsMatch = text.match(/investors\s*[:•]\s*(.{5,300}?)(?:\n\s*\n)/i);

    if (totalRaisedMatch || lastRoundMatch || investorsMatch) {
      data.funding = {
        totalRaised: totalRaisedMatch ? totalRaisedMatch[1].trim() : null,
        lastRound: lastRoundMatch ? lastRoundMatch[1].trim() : null,
        lastRoundAmount: null,
        investors: investorsMatch
          ? investorsMatch[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 10)
          : [],
        confidence: "direct",
      };
    }

    // People from leadership section
    const leaderPattern = /([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)\s*[-–,]\s*(.{5,80}?)(?:\n|$)/gm;
    let match;
    const seenNames = new Set<string>();
    while ((match = leaderPattern.exec(text)) !== null) {
      const name = match[1].trim();
      const title = match[2].trim();
      if (name.length < 50 && !seenNames.has(name.toLowerCase())) {
        seenNames.add(name.toLowerCase());
        data.people.push({
          name,
          title,
          department: null,
          source: page.url,
          confidence: "direct",
        });
      }
    }

    logger.info({ url: page.url, peopleCount: data.people.length }, "crunchbase extraction complete");
  } catch (err: any) {
    logger.warn({ url: page.url, error: err.message }, "crunchbase extraction error");
  }

  return data;
}
