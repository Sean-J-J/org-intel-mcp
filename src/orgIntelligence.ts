import { searchCompanyInfo, fetchPage } from "./scraper.js";
import { analyzeWithPrompt } from "./deepseek.js";

export interface ResearchOptions {
  companyName: string;
  businessNeed?: string;
  depth?: "quick" | "standard" | "deep";
}

/**
 * The main research orchestration function.
 * Phase 1: Gather public data about the company
 * Phase 2: DeepSeek analyzes the data for org structure
 * Phase 3: Map decision authority for the business need
 * Phase 4: Format the final report
 */
export async function researchCompany(options: ResearchOptions): Promise<string> {
  const { companyName, businessNeed, depth = "standard" } = options;
  const maxSources = depth === "deep" ? 10 : depth === "quick" ? 3 : 6;

  // Phase 1: Gather data
  console.error(`[${companyName}] Phase 1: Gathering public data...`);
  const sources = await searchCompanyInfo(companyName);

  // For deep mode, also try to find team/people pages
  if (depth === "deep" && sources["website"]) {
    const teamPageResults = await searchForTeamPage(companyName, sources["website"]);
    if (teamPageResults) {
      sources["team"] = teamPageResults;
    }
  }

  // Summarize what we found
  const sourceSummary = Object.entries(sources)
    .map(([key, text]) => {
      const lineCount = text.split("\n").length;
      return `- ${key}: ~${lineCount} lines of content`;
    })
    .join("\n");

  console.error(`[${companyName}] Sources found: ${Object.keys(sources).length}`);

  // Phase 2: Analyze organizational structure
  console.error(`[${companyName}] Phase 2: Analyzing org structure...`);
  const orgAnalysis = await analyzeOrgStructure(companyName, sources, depth);

  // Phase 3: Decision mapping (if business need provided)
  let decisionMapping = "";
  if (businessNeed) {
    console.error(`[${companyName}] Phase 3: Mapping decision authority for: ${businessNeed}...`);
    decisionMapping = await mapDecisionAuthority(companyName, businessNeed, orgAnalysis, sources, depth);
  }

  // Phase 4: Format comprehensive report
  console.error(`[${companyName}] Phase 4: Formatting report...`);
  return formatReport(companyName, businessNeed, sourceSummary, orgAnalysis, decisionMapping, depth);
}

/**
 * Try to find team/people/about pages on the company website.
 */
async function searchForTeamPage(companyName: string, websiteContent: string): Promise<string | null> {
  const teamPaths = ["/team", "/about", "/leadership", "/company/team", "/people", "/management"];
  const baseUrlMatch = websiteContent.match(/=== From: (https?:\/\/[^\/]+)/);
  if (!baseUrlMatch) return null;

  const baseUrl = baseUrlMatch[1];
  for (const path of teamPaths) {
    const page = await fetchPage(`${baseUrl}${path}`);
    if (page && page.text.length > 200) {
      return `\n=== Team Page: ${baseUrl}${path} ===\n${page.text}\n`;
    }
  }
  return null;
}

/**
 * Use DeepSeek to analyze raw scraped content and extract organizational structure.
 */
async function analyzeOrgStructure(
  companyName: string,
  sources: Record<string, string>,
  depth: string
): Promise<string> {
  const combinedContent = Object.entries(sources)
    .map(([key, text]) => `--- Source: ${key} ---\n${text}`)
    .join("\n\n")
    .slice(0, 15000); // Limit input size

  const systemPrompt = `You are an expert organizational intelligence analyst. You specialize in analyzing publicly available information to reconstruct a company's organizational structure.

Your task is to analyze the provided scraped web content about ${companyName} and extract or infer:

1. **Executive Leadership Team** — C-suite, VPs, and their likely reporting lines
2. **Department Structure** — Key departments (Engineering, Sales, Marketing, Product, Operations, Finance, HR, Legal, etc.) and their heads
3. **Team Sizes & Locations** — Major office locations, team size indicators
4. **Organizational Maturity** — Is it a startup, growth-stage, or enterprise? Flat or hierarchical?
5. **Key Roles & Responsibilities** — What each executive/department appears to own
6. **Confidence Assessment** — For each finding, indicate whether it's DIRECT (explicitly stated in data), INFERRED (reasonable deduction from context), or SPECULATIVE (best guess from limited data)

Be thorough but honest about uncertainty. If data is insufficient, say so. Focus on actionable intelligence about who does what.`;

  try {
    const analysis = await analyzeWithPrompt(systemPrompt, combinedContent, {
      model: "deepseek-v4-pro",
      maxTokens: depth === "deep" ? 4096 : 2048,
      thinking: true,
    });
    return analysis || "Unable to analyze organizational structure from available data.";
  } catch (err: any) {
    return `Error during org analysis: ${err.message}`;
  }
}

/**
 * Use DeepSeek to map specific business needs to the right decision-makers.
 */
async function mapDecisionAuthority(
  companyName: string,
  businessNeed: string,
  orgContext: string,
  sources: Record<string, string>,
  depth: string
): Promise<string> {
  const combinedContent = Object.entries(sources)
    .map(([key, text]) => `--- Source: ${key} ---\n${text}`)
    .join("\n\n")
    .slice(0, 10000);

  const systemPrompt = `You are an expert B2B sales and partnership intelligence analyst. Given a company's organizational analysis and a specific business need, determine:

1. **Primary Department** — Which department owns this type of purchase/investment?
2. **Key Decision-Makers** — Specific titles/roles that would be involved
3. **Decision Process** — Likely approval chain (champion → manager → director → VP → C-suite)
4. **Influencers vs Decision-Makers** — Who recommends vs who approves?
5. **Budget Authority** — Who likely controls the budget for this
6. **Entry Strategy** — Recommended approach for reaching the right person
7. **Potential Objections** — What each stakeholder would care about
8. **Alternative Contacts** — If primary targets are unavailable

For each person/role, indicate confidence level. Consider the company's industry, size, and maturity.`;

  try {
    const mapping = await analyzeWithPrompt(
      systemPrompt,
      `Company: ${companyName}\nBusiness Need: ${businessNeed}\n\nOrganizational Context:\n${orgContext}\n\nSource Data:\n${combinedContent}`,
      {
        model: "deepseek-v4-pro",
        maxTokens: depth === "deep" ? 4096 : 2048,
        thinking: true,
      }
    );
    return mapping || "Unable to determine decision authority from available data.";
  } catch (err: any) {
    return `Error during decision mapping: ${err.message}`;
  }
}

/**
 * Format the final comprehensive report.
 */
function formatReport(
  companyName: string,
  businessNeed: string | undefined,
  sourceSummary: string,
  orgAnalysis: string,
  decisionMapping: string,
  depth: string
): string {
  const lines = [
    "=".repeat(70),
    `  ORGANIZATIONAL INTELLIGENCE REPORT`,
    `  Company: ${companyName}`,
    `  Research Depth: ${depth}`,
    `  Generated: ${new Date().toISOString().split("T")[0]}`,
    "=".repeat(70),
    "",
    "--- DATA SOURCES ---",
    sourceSummary,
    "",
    "--- ORGANIZATIONAL STRUCTURE ANALYSIS ---",
    orgAnalysis,
    "",
  ];

  if (businessNeed) {
    lines.push(
      "--- DECISION AUTHORITY MAPPING ---",
      `Business Need: ${businessNeed}`,
      "",
      decisionMapping,
      ""
    );
  }

  lines.push(
    "=".repeat(70),
    "  DISCLAIMER",
    "  This report is generated from publicly available web data and AI analysis.",
    "  Findings may not reflect the current organizational structure.",
    "  Always verify critical information directly with the company.",
    "=".repeat(70)
  );

  return lines.join("\n");
}
