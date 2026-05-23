import {
  ScoredFinding,
  VerifiedFindings,
  DecisionMap,
  StructuredCompanyData,
  OrgStructureResult,
  ClassifiedDepartment,
} from "../types.js";

interface ReportData {
  companyName: string;
  businessNeed?: string;
  depth: string;
  sourceSummary: string;
  entities: any;
  orgStructure: OrgStructureResult;
  departments: ClassifiedDepartment[];
  verifiedFindings: VerifiedFindings;
  decisionMap: DecisionMap | null;
  sources: StructuredCompanyData[];
}

export function formatReport(data: ReportData): string {
  const {
    companyName,
    businessNeed,
    depth,
    sourceSummary,
    entities,
    orgStructure,
    departments,
    verifiedFindings,
    decisionMap,
    sources,
  } = data;

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
    formatSourceDetails(sources),
    "",
    "--- EXECUTIVE SUMMARY ---",
    formatExecutiveSummary(companyName, entities, departments, sources),
    "",
    "--- ORGANIZATIONAL STRUCTURE ---",
    formatOrgStructure(entities, orgStructure, departments),
    "",
    "--- DEPARTMENT ANALYSIS ---",
    formatDepartments(departments, entities),
    "",
    "--- KEY PERSONNEL ---",
    formatPeople(entities),
    "",
    "--- SOURCE VERIFICATION ---",
    formatVerification(verifiedFindings),
    "",
  ];

  if (businessNeed && decisionMap) {
    lines.push(
      "--- DECISION AUTHORITY MAPPING ---",
      `Business Need: ${businessNeed}`,
      "",
      formatDecisionMap(decisionMap),
      ""
    );
  }

  lines.push(
    "--- RESEARCH GAPS & LIMITATIONS ---",
    formatLimitations(sources, entities),
    "",
    "=".repeat(70),
    "  DISCLAIMER",
    "  This report is generated from publicly available web data and AI analysis.",
    "  Findings may not reflect the current organizational structure.",
    "  Always verify critical information directly with the company.",
    "=".repeat(70)
  );

  return lines.join("\n");
}

function formatSourceDetails(sources: StructuredCompanyData[]): string {
  const lines = ["### Sources Retrieved", ""];
  for (const s of sources) {
    const typeLabel = s.sourceType.toUpperCase();
    lines.push(`- **[${typeLabel}]** ${s.source}`);
    if (s.description) lines.push(`  ${s.description.slice(0, 200)}`);
    lines.push(`  People: ${s.people.length} | Departments: ${s.departments.length}`);
    lines.push("");
  }
  return lines.join("\n");
}

function formatExecutiveSummary(
  companyName: string,
  entities: any,
  departments: ClassifiedDepartment[],
  sources: StructuredCompanyData[]
): string {
  const companyInfo = entities.companyInfo || {};
  const info: string[] = [];
  if (companyInfo.description) info.push(companyInfo.description.slice(0, 300));
  if (companyInfo.industry) info.push(`**Industry:** ${companyInfo.industry}`);
  if (companyInfo.size) info.push(`**Company Size:** ${companyInfo.size}`);
  if (companyInfo.headquarters) info.push(`**Headquarters:** ${companyInfo.headquarters}`);
  if (companyInfo.founded) info.push(`**Founded:** ${companyInfo.founded}`);

  return [
    ...info,
    "",
    `**People Identified:** ${entities.people?.length || 0}`,
    `**Departments Mapped:** ${departments.length}`,
    `**Data Sources:** ${sources.map((s) => s.sourceType).filter((v, i, a) => a.indexOf(v) === i).join(", ")}`,
  ].join("\n");
}

function formatOrgStructure(
  entities: any,
  orgStructure: OrgStructureResult,
  departments: ClassifiedDepartment[]
): string {
  const lines: string[] = [];

  if (orgStructure.reportingLines.length > 0) {
    lines.push("### Reporting Structure", "");
    for (const line of orgStructure.reportingLines) {
      lines.push(`- ${line.person} → **${line.reportsTo}** (${line.confidence})`);
    }
    lines.push("");
  }

  if (orgStructure.teams.length > 0) {
    lines.push("### Teams", "");
    for (const team of orgStructure.teams) {
      lines.push(`- **${team.name}** — led by ${team.lead}`);
    }
    lines.push("");
  }

  lines.push("### Hierarchy Analysis", "", orgStructure.hierarchySummary, "");
  return lines.join("\n");
}

function formatDepartments(
  departments: ClassifiedDepartment[],
  entities: any
): string {
  const lines: string[] = [];
  const funcGroups = new Map<string, ClassifiedDepartment[]>();
  for (const dept of departments) {
    const existing = funcGroups.get(dept.function) || [];
    existing.push(dept);
    funcGroups.set(dept.function, existing);
  }

  const funcOrder = ["executive", "engineering", "product", "sales", "marketing", "finance", "hr", "legal", "operations", "other"];
  for (const func of funcOrder) {
    const depts = funcGroups.get(func);
    if (!depts || depts.length === 0) continue;
    lines.push(`### ${func.charAt(0).toUpperCase() + func.slice(1)}`, "");
    for (const dept of depts) {
      const head = dept.head ? ` (Head: ${dept.head})` : "";
      lines.push(`- **${dept.name}**${head} — ${dept.keyMembers.length} members`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatPeople(entities: any): string {
  const lines: string[] = [];
  const people = entities.people || [];

  // Group by confidence
  const direct = people.filter((p: any) => {
    // Simple heuristic: if we have a full name and title, it's direct
    return p.name && p.title && p.name.split(" ").length >= 2;
  });

  if (direct.length > 0) {
    lines.push(`### Directly Identified (${direct.length} people)`, "");
    for (const p of direct) {
      const dept = p.department ? ` [${p.department}]` : "";
      lines.push(`- **${p.name}** — ${p.title}${dept}`);
      lines.push(`  Source: ${p.source}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatVerification(verified: VerifiedFindings): string {
  const lines: string[] = [];
  const direct = verified.consensus.filter((f) => f.confidence === "direct").length;
  const inferred = verified.consensus.filter((f) => f.confidence === "inferred").length;
  const speculative = verified.consensus.filter((f) => f.confidence === "speculative").length;

  lines.push(`- **DIRECT:** ${direct} findings (explicitly sourced)`);
  lines.push(`- **INFERRED:** ${inferred} findings (reasonable deduction)`);
  lines.push(`- **SPECULATIVE:** ${speculative} findings (best estimate)`);
  lines.push("");

  if (verified.discrepancies.length > 0) {
    lines.push(`### Discrepancies (${verified.discrepancies.length})`, "");
    for (const d of verified.discrepancies) {
      lines.push(`- **Conflict:** ${d.finding1.statement} vs ${d.finding2.statement}`);
      if (d.resolution) lines.push(`  Resolution: ${d.resolution}`);
    }
    lines.push("");
  }

  lines.push(verified.summary);
  return lines.join("\n");
}

function formatDecisionMap(dm: DecisionMap): string {
  const lines = [
    `### Primary Department: ${dm.primaryDepartment}`,
    "",
    "### Key Decision-Makers",
    "",
  ];

  for (const kdm of dm.keyDecisionMakers) {
    const badge = kdm.influence === "decision-maker" ? "[DECISION MAKER]" : kdm.influence === "influencer" ? "[INFLUENCER]" : "[GATEKEEPER]";
    lines.push(`- ${badge} **${kdm.role}** (${kdm.confidence})`);
  }

  lines.push(
    "",
    "### Decision Process",
    "",
    dm.decisionProcess,
    "",
    "### Budget Authority",
    "",
    dm.budgetAuthority,
    "",
    "### Entry Strategy",
    "",
    dm.entryStrategy,
    "",
    "### Potential Objections & Mitigations",
    ""
  );

  for (const obj of dm.potentialObjections) {
    lines.push(`- **${obj.stakeholder}:** ${obj.concern}`);
  }

  if (dm.alternativeContacts.length > 0) {
    lines.push(
      "",
      "### Alternative Contacts",
      "",
      ...dm.alternativeContacts.map((c) => `- ${c}`)
    );
  }

  return lines.join("\n");
}

function formatLimitations(sources: StructuredCompanyData[], entities: any): string {
  const lines: string[] = [];

  // Source gaps
  const sourceTypes = sources.map((s) => s.sourceType);
  if (!sourceTypes.includes("linkedin")) lines.push("- LinkedIn data was not available for this company");
  if (!sourceTypes.includes("crunchbase")) lines.push("- Crunchbase profile was not found");
  if (!sourceTypes.includes("website")) lines.push("- Company website could not be resolved or fetched");

  // Data gaps
  const people = entities.people || [];
  if (people.length === 0) {
    lines.push("- No named individuals were found in the source data");
  }
  if (people.length > 0 && people.length < 5) {
    lines.push("- Limited personnel data — only a few named individuals found");
  }

  const deptCount = (entities.departments || []).length;
  if (deptCount === 0) {
    lines.push("- No departmental structure was identified");
  }

  if (lines.length === 0) {
    lines.push("- No significant limitations identified");
  }

  lines.push("", "*Note: The absence of data does not mean the absence of a structure — only that it was not found in publicly available sources at this time.*");
  return lines.join("\n");
}
