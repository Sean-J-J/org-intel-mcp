export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface SearchQuery {
  key: string;
  query: string;
}

export interface RenderedPage {
  url: string;
  title: string;
  html: string;
  text: string;
  links: string[];
  renderMethod: "http" | "playwright";
}

export interface ExtractedPerson {
  name: string | null;
  title: string | null;
  department: string | null;
  source: string;
  confidence: "direct" | "inferred";
}

export interface ExtractedDepartment {
  name: string;
  headName: string | null;
  headTitle: string | null;
  teamSize: string | null;
  confidence: "direct" | "inferred";
}

export interface ExtractedLocation {
  city: string | null;
  country: string | null;
  type: "headquarters" | "office" | "unknown";
  confidence: "direct" | "inferred";
}

export interface ExtractedFunding {
  totalRaised: string | null;
  lastRound: string | null;
  lastRoundAmount: string | null;
  investors: string[];
  confidence: "direct" | "inferred";
}

export interface StructuredCompanyData {
  source: string;
  sourceType: "linkedin" | "crunchbase" | "website" | "news" | "search_snippet" | "unknown";
  companyName: string | null;
  industry: string | null;
  companySize: string | null;
  founded: number | null;
  headquarters: string | null;
  description: string | null;
  specialties: string[];
  website: string | null;
  people: ExtractedPerson[];
  departments: ExtractedDepartment[];
  locations: ExtractedLocation[];
  funding: ExtractedFunding | null;
  rawText: string;
}

export interface EntityExtractionResult {
  people: Array<{ name: string; title: string; department: string | null; source: string }>;
  departments: Array<{ name: string; headName: string | null; headTitle: string | null }>;
  locations: Array<{ city: string; country: string; type: string }>;
  companyInfo: {
    name: string | null;
    industry: string | null;
    size: string | null;
    founded: number | null;
    headquarters: string | null;
    description: string | null;
  };
}

export interface OrgStructureResult {
  reportingLines: Array<{
    person: string;
    reportsTo: string;
    confidence: "direct" | "inferred" | "speculative";
  }>;
  teams: Array<{
    name: string;
    lead: string;
    members: string[];
    function: string;
  }>;
  hierarchySummary: string;
}

export interface ClassifiedDepartment {
  name: string;
  function: "engineering" | "sales" | "marketing" | "product" | "finance" | "hr" | "legal" | "operations" | "executive" | "other";
  head: string | null;
  keyMembers: string[];
  confidence: "direct" | "inferred" | "speculative";
}

export interface ScoredFinding {
  statement: string;
  category: "person" | "department" | "structure" | "company_info";
  confidence: "direct" | "inferred" | "speculative";
  evidence: string;
  sources: string[];
}

export interface VerifiedFindings {
  consensus: ScoredFinding[];
  discrepancies: Array<{
    finding1: ScoredFinding;
    finding2: ScoredFinding;
    resolution: string;
  }>;
  summary: string;
}

export interface DecisionMap {
  primaryDepartment: string;
  keyDecisionMakers: Array<{
    role: string;
    influence: "decision-maker" | "influencer" | "gatekeeper";
    confidence: "direct" | "inferred" | "speculative";
    contactInfo?: string;
  }>;
  decisionProcess: string;
  budgetAuthority: string;
  entryStrategy: string;
  potentialObjections: Array<{
    stakeholder: string;
    concern: string;
    mitigation: string;
  }>;
  alternativeContacts: string[];
}

export interface ResearchOptions {
  companyName: string;
  businessNeed?: string;
  depth?: "quick" | "standard" | "deep";
  onProgress?: (phase: string, message: string) => void;
}
