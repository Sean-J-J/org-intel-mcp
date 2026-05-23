import { SearchQuery } from "../types.js";

/**
 * Keywords commonly found in LinkedIn job titles — helps narrow profile searches
 * to actual decision-makers, not random employees.
 */
const DECISION_MAKER_TITLES = [
  "chief", "president", "governor", "vice president", "vp ",
  "director", "head of", "head ", "senior director", "managing director",
  "executive director", "general manager", "partner",
];

/**
 * Map business need keywords to LinkedIn-friendly search terms.
 */
const BUSINESS_NEED_TERMS: Record<string, string[]> = {
  // Payment / Fintech
  payment: ["payment", "payments", "fintech", "PSP", "gateway", "acquiring"],
  fintech: ["fintech", "innovation", "sandbox", "digital"],
  licensing: ["licensing", "license", "approval", "authorization", "regulatory"],
  supervision: ["supervision", "supervisor", "compliance", "regulatory", "AML"],
  banking: ["banking", "bank", "financial", "deposit", "lending"],
  insurance: ["insurance", "insurtech", "underwriting"],
  technology: ["technology", "IT", "digital", "transformation", "engineering"],
  procurement: ["procurement", "purchasing", "supply chain", "vendor", "sourcing"],
  marketing: ["marketing", "brand", "growth", "demand generation", "CMO"],
  sales: ["sales", "revenue", "business development", "account executive"],
  hr: ["human resources", "HR", "talent", "people operations", "recruiting"],
  finance: ["finance", "CFO", "treasury", "accounting", "FP&A"],
  legal: ["legal", "general counsel", "compliance", "regulatory"],
  operations: ["operations", "COO", "supply chain", "logistics"],
  cloud: ["cloud", "AWS", "Azure", "GCP", "infrastructure", "SaaS"],
  security: ["security", "cybersecurity", "CISO", "infosec", "SOC"],
  data: ["data", "analytics", "AI", "machine learning", "BI"],
};

/**
 * Extract relevant search terms from a business need description.
 */
function extractBusinessTerms(businessNeed: string): string[] {
  const need = businessNeed.toLowerCase();
  const matched = new Set<string>();

  for (const [category, terms] of Object.entries(BUSINESS_NEED_TERMS)) {
    for (const term of terms) {
      if (need.includes(term)) {
        matched.add(category);
        break;
      }
    }
  }

  // If nothing matched, split the business need into keywords
  if (matched.size === 0) {
    return businessNeed
      .split(/[\s,;|/]+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);
  }

  // Flatten matched categories' terms, take top 6
  const allTerms: string[] = [];
  for (const cat of matched) {
    allTerms.push(...(BUSINESS_NEED_TERMS[cat] || []));
  }
  return [...new Set(allTerms)].slice(0, 6);
}

export function buildSearchQueries(companyName: string): SearchQuery[] {
  return [
    // LinkedIn — highest priority sources
    {
      key: "linkedin_company",
      query: `site:linkedin.com/company ${companyName}`,
    },
    {
      key: "linkedin_leadership",
      query: `site:linkedin.com/in "${companyName}" chief OR president OR governor OR vice OR director OR head`,
    },
    {
      key: "linkedin_officers",
      query: `site:linkedin.com/in "${companyName}" officer OR executive OR senior OR manager`,
    },
    // Crunchbase
    {
      key: "crunchbase",
      query: `site:crunchbase.com/organization ${companyName}`,
    },
    // Official site & Wikipedia
    {
      key: "domain",
      query: `${companyName} official website`,
    },
    {
      key: "wikipedia",
      query: `site:en.wikipedia.org ${companyName}`,
    },
    // Company info
    {
      key: "company_about",
      query: `"${companyName}" company about profile overview`,
    },
    // Leadership
    {
      key: "leadership",
      query: `"${companyName}" leadership team "board of directors" OR "executive team" OR "management team"`,
    },
    // News
    {
      key: "news",
      query: `"${companyName}" news leadership executive appointment announcement`,
    },
    // Organization-specific
    {
      key: "org_structure",
      query: `"${companyName}" organizational structure departments divisions`,
    },
  ];
}

/**
 * Generate targeted LinkedIn profile search queries based on the business need.
 * These use site:linkedin.com/in with specific role/title keywords derived from
 * the business need description.
 */
export function buildTargetedLinkedInQueries(
  companyName: string,
  businessNeed: string
): SearchQuery[] {
  const terms = extractBusinessTerms(businessNeed);
  if (terms.length === 0) return [];

  const queries: SearchQuery[] = [];

  // Query 1: Decision-maker titles + business terms
  const titleTerms = DECISION_MAKER_TITLES.map((t) => `"${t}"`).join(" OR ");
  const bizTerms = terms.map((t) => `"${t}"`).join(" OR ");
  queries.push({
    key: "linkedin_targeted_leaders",
    query: `site:linkedin.com/in "${companyName}" (${titleTerms}) (${bizTerms})`,
  });

  // Query 2: Broader search — any profile with company name and business terms
  queries.push({
    key: "linkedin_targeted_broad",
    query: `site:linkedin.com/in "${companyName}" ${terms.join(" OR ")}`,
  });

  // Query 3: Head of / Director specific targeting
  queries.push({
    key: "linkedin_targeted_heads",
    query: `site:linkedin.com/in "${companyName}" "head of" OR "director of" ${terms.slice(0, 3).join(" OR ")}`,
  });

  return queries;
}
