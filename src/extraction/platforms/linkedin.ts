import { RenderedPage, StructuredCompanyData, ExtractedPerson } from "../../types.js";
import { logger } from "../../utils/logger.js";

/**
 * Parse a LinkedIn company page HTML and extract structured company data.
 * Handles both the public (logged-out) view and rendered Playwright content.
 */
export function extractLinkedInCompany(page: RenderedPage): StructuredCompanyData {
  const data: StructuredCompanyData = {
    source: page.url,
    sourceType: "linkedin",
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

    // --- Company Name ---
    data.companyName = extractCompanyName(page.title, text);

    // --- Industry ---
    const industryMatch = text.match(/(?:industry|sector)\s*[:•]\s*(.+?)(?:\s{2,}|\n|$)/i);
    if (industryMatch) data.industry = industryMatch[1].trim();

    // --- Company Size ---
    const sizeMatch = text.match(/(?:company size|employees?)\s*[:•]\s*([\d,]+[+-]?\s*(?:employees|staff|members|associates)?)/i);
    if (sizeMatch) data.companySize = sizeMatch[1].trim();
    if (!data.companySize) {
      const altSize = text.match(/([\d,]{2,7})\s*(?:employees|staff|members)/i);
      if (altSize) data.companySize = altSize[1].trim() + " employees";
    }

    // --- Founded ---
    const foundedMatch = text.match(/founded\s*[:•]*\s*(\d{4})/i);
    if (foundedMatch) data.founded = parseInt(foundedMatch[1], 10);

    // --- Headquarters ---
    const hqMatch = text.match(/headquarters\s*[:•]\s*(.+?)(?:\s{2,}|\n|$)/i);
    if (hqMatch) data.headquarters = hqMatch[1].trim();

    // --- Description ---
    data.description = extractDescription(text);

    // --- Specialties ---
    const specMatch = text.match(/specialties\s*[:•]\s*(.+?)(?:\n\s*\n|\n[A-Z]|$)/is);
    if (specMatch) {
      data.specialties = specMatch[1]
        .split(/[,;•]/)
        .map((s) => s.trim())
        .filter((s: string) => Boolean(s))
        .slice(0, 15);
    }

    // --- Website ---
    const webMatch = text.match(/website\s*[:•]\s*(https?:\/\/[^\s]+)/i);
    if (webMatch) data.website = webMatch[1].trim();

    // --- People: Extract from the page ---
    extractPeopleComprehensive(text, page.url, data.people);

    // --- Departments ---
    extractDepartments(text, data.departments);

    logger.info(
      { url: page.url, people: data.people.length, depts: data.departments.length },
      "linkedin company extraction"
    );
  } catch (err: any) {
    logger.warn({ url: page.url, error: err.message }, "linkedin extraction error");
  }

  return data;
}

/**
 * Parse a LinkedIn individual profile page.
 */
export function extractLinkedInPerson(page: RenderedPage): StructuredCompanyData {
  const data: StructuredCompanyData = {
    source: page.url,
    sourceType: "linkedin",
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
    const title = page.title;

    // Person name from page title (LinkedIn format: "Name - Title - Company | LinkedIn")
    const nameMatch = title.match(/^(.+?)\s*[-–|]\s*LinkedIn/i);
    const personName = nameMatch ? nameMatch[1].trim().split(" - ")[0].split(" | ")[0].trim() : null;

    // Current position
    let personTitle: string | null = null;
    let companyName: string | null = null;

    // Try multiple patterns to find current position
    const titlePatterns = [
      // "Title at Company" pattern
      /(.{5,80}?)\s+at\s+([A-Z][A-Za-z0-9\s&.-]{2,40}?)(?:\s{2,}|\n|·|$)/i,
      // "Title · Company" pattern
      /(.{5,80}?)\s+[·•]\s+([A-Z][A-Za-z0-9\s&.-]{2,40}?)(?:\s{2,}|\n|$)/i,
      // Location-based: "Title\nCompany\nLocation"
      /^(.{5,80})\n([A-Z][A-Za-z0-9\s&.-]{2,40})\n(?:.{0,40})\n/m,
    ];

    for (const pattern of titlePatterns) {
      const match = text.match(pattern);
      if (match) {
        personTitle = match[1].trim();
        companyName = match[2].trim();
        break;
      }
    }

    if (personName) {
      data.people.push({
        name: personName,
        title: personTitle,
        department: null,
        source: page.url,
        confidence: "direct",
      });
    }

    if (companyName) data.companyName = companyName;

    // Try to find more people mentioned (colleagues, etc.)
    extractPeopleComprehensive(text, page.url, data.people);

    logger.info({ url: page.url, personName, title: personTitle }, "linkedin person extraction");
  } catch (err: any) {
    logger.warn({ url: page.url, error: err.message }, "linkedin person extraction error");
  }

  return data;
}

// ─── Private Helpers ───────────────────────────────────────────

function extractCompanyName(title: string, text: string): string | null {
  // From title: "Company Name | LinkedIn"
  const tMatch = title.match(/^(.+?)\s*[|·]\s*LinkedIn/i);
  if (tMatch) return tMatch[1].trim();

  // From text: first substantial line
  const lines = text.split("\n").filter((l) => l.trim().length > 3);
  for (const line of lines.slice(0, 3)) {
    const clean = line.trim();
    if (clean.length > 3 && clean.length < 80 && !clean.match(/^(followers|employees|industry|linkedin|home|jobs|sign|about)/i)) {
      return clean;
    }
  }
  return null;
}

function extractDescription(text: string): string | null {
  // LinkedIn's "About" or "Overview" section
  const overviewMatch = text.match(/Overview\s*\n+(.{100,2000}?)(?:\n\s*\n|\n[A-Z]|\n\d)/s);
  if (overviewMatch) return overviewMatch[1].trim();

  const aboutMatch = text.match(/About us\s*\n+(.{100,2000}?)(?:\n\s*\n|\n[A-Z]|\n\d)/s);
  if (aboutMatch) return aboutMatch[1].trim();

  // First substantial paragraph
  const paras = text.split(/\n\s*\n/);
  for (const para of paras) {
    if (para.length > 150 && para.length < 3000) return para.trim();
  }

  return null;
}

function extractPeopleComprehensive(text: string, source: string, people: ExtractedPerson[]): void {
  const seen = new Set(people.map((p) => p.name?.toLowerCase()).filter(Boolean));

  // Pattern 1: "Name – Title" (LinkedIn people listings)
  const pattern1 = /([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\s*[-–]\s*(.{5,80}?)(?:\s{2,}|\n|$)/gm;
  let match;
  while ((match = pattern1.exec(text)) !== null) {
    const name = match[1].trim();
    const title = match[2].trim();
    if (isValidPersonName(name) && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      people.push({ name, title, department: inferDepartment(title), source, confidence: "direct" });
    }
  }

  // Pattern 2: "Name, Title" (search result snippets)
  const pattern2 = /([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\s*,\s*(.{5,80}?)(?:\sat\s|·|\n|$)/gm;
  while ((match = pattern2.exec(text)) !== null) {
    const name = match[1].trim();
    const title = match[2].trim();
    if (isValidPersonName(name) && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      people.push({ name, title, department: inferDepartment(title), source, confidence: "direct" });
    }
  }

  // Pattern 3: Title-based matching (e.g., "Chief Executive Officer" or "Vice President of...")
  const titlePattern = /\b((?:Chief|Vice\s*President|SVP|EVP|C[A-Z]O|Director|Head|President|Governor|Deputy)\s.{5,80}?)(?:\sat\s|·|\n|,|$)/gi;
  while ((match = titlePattern.exec(text)) !== null) {
    const title = match[1].trim();
    // Try to find a name before this title (look back ~80 chars)
    const before = text.slice(Math.max(0, match.index - 80), match.index);
    const nameBefore = before.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\s*$/);
    if (nameBefore) {
      const name = nameBefore[1].trim();
      if (isValidPersonName(name) && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        people.push({ name, title, department: inferDepartment(title), source, confidence: "direct" });
      }
    }
  }
}

function extractDepartments(text: string, departments: StructuredCompanyData["departments"]): void {
  const deptKeywords = [
    "engineering", "sales", "marketing", "product", "finance",
    "human resources", "hr", "legal", "operations", "it",
    "research", "development", "customer", "support",
    "compliance", "risk", "treasury", "audit",
    "payment systems", "banking supervision", "insurance",
    "international", "investment",
  ];

  for (const dept of deptKeywords) {
    const regex = new RegExp(`\\b${dept}\\b.{0,50}?(?:department|team|division|unit|group)`, "gi");
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      departments.push({
        name: dept.charAt(0).toUpperCase() + dept.slice(1),
        headName: null,
        headTitle: null,
        teamSize: null,
        confidence: "inferred",
      });
    }
  }
}

function isValidPersonName(name: string): boolean {
  if (name.length < 5 || name.length > 50) return false;
  if (/^\d/.test(name)) return false;
  // Skip common false positives
  const invalidWords = /\b(the|this|that|with|from|about|when|after|search|login|sign|home|jobs|follow|followers|employees|industry|linkedin|overview|about us|see all|view all|learn more|show more|load more|page \d|contact|careers|privacy|terms|copyright|accessibility)\b/i;
  if (invalidWords.test(name)) return false;
  // Must have at least 2 words (first + last name)
  if (name.split(/\s+/).length < 2) return false;
  return true;
}

function inferDepartment(title: string): string | null {
  const t = title.toLowerCase();
  const map: Record<string, string> = {
    "engineer": "Engineering", "developer": "Engineering", "cto": "Engineering", "chief technology": "Engineering",
    "sales": "Sales", "business development": "Sales", "account": "Sales", "revenue": "Sales",
    "market": "Marketing", "brand": "Marketing", "growth": "Marketing", "content": "Marketing",
    "product": "Product", "design": "Product",
    "financ": "Finance", "accounting": "Finance", "treasur": "Finance", "cfo": "Finance", "chief financial": "Finance",
    "human resource": "HR", "hr": "HR", "people": "HR", "talent": "HR",
    "legal": "Legal", "compliance": "Legal", "counsel": "Legal",
    "operation": "Operations", "supply chain": "Operations",
    "chief executive": "Executive", "ceo": "Executive", "president": "Executive", "governor": "Executive",
    "risk": "Risk", "audit": "Risk",
    "payment": "Payment Systems", "settlement": "Payment Systems",
    "supervision": "Supervision", "regulatory": "Supervision",
    "research": "Research", "international": "International",
    "investment": "Investment", "portfolio": "Investment",
  };
  for (const [keyword, dept] of Object.entries(map)) {
    if (t.includes(keyword)) return dept;
  }
  return null;
}
