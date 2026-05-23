import { RenderedPage, StructuredCompanyData } from "../../types.js";
import { logger } from "../../utils/logger.js";

export function extractNews(page: RenderedPage): StructuredCompanyData {
  const data: StructuredCompanyData = {
    source: page.url,
    sourceType: "news",
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

    // Extract named entities: people mentioned with titles
    const patterns = [
      /([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3}),\s*(?:the\s)?(?:company's\s)?([A-Z][a-z]+.{5,60}?)(?:,|\.|\ssaid|\sannounced)/g,
      /(?:appointed|named|promoted|hired)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\s+(?:as\s+)?(?:the\s)?(?:new\s)?(.{5,60}?)(?:,|\.|\n)/gi,
    ];

    const seenNames = new Set<string>();
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1].trim();
        const title = match[2].trim();
        if (
          name.length > 5 &&
          name.length < 50 &&
          !seenNames.has(name.toLowerCase()) &&
          !name.match(/\b(The|This|That|When|About|After|With|From|News)\b/)
        ) {
          seenNames.add(name.toLowerCase());
          data.people.push({
            name,
            title: title.length < 100 ? title : title.slice(0, 97) + "...",
            department: null,
            source: page.url,
            confidence: "direct",
          });
        }
      }
    }

    logger.info({ url: page.url, peopleCount: data.people.length }, "news extraction complete");
  } catch (err: any) {
    logger.warn({ url: page.url, error: err.message }, "news extraction error");
  }

  return data;
}
