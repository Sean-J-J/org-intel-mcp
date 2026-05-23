import { getDeepSeekClient } from "../client.js";
import { CONFIDENCE_SCORING } from "../prompts.js";
import {
  EntityExtractionResult,
  OrgStructureResult,
  ClassifiedDepartment,
  ScoredFinding,
  StructuredCompanyData,
} from "../../types.js";
import { getPhaseConfig } from "../../config.js";
import { logger } from "../../utils/logger.js";

export async function scoreConfidence(
  entities: EntityExtractionResult,
  orgStructure: OrgStructureResult,
  departments: ClassifiedDepartment[],
  sources: StructuredCompanyData[],
  companyName: string,
  depth: "quick" | "standard" | "deep"
): Promise<ScoredFinding[]> {
  const config = getPhaseConfig(depth);
  const client = getDeepSeekClient();

  // Algorithmic pre-scoring before LLM review
  const preScored = preScoreFindings(entities, orgStructure, departments, sources);

  // For quick mode, algorithmic scoring is sufficient
  if (depth === "quick") {
    logger.info({ count: preScored.length }, "confidence scoring complete (algorithmic)");
    return preScored;
  }

  // For standard/deep, let the LLM review
  const userContent = `Company: ${companyName}

Algorithmic confidence scores:
${JSON.stringify(preScored, null, 2)}

Source data quality:
${sources.map((s) => `${s.sourceType} (${s.source}): ${s.people.length} people, ${s.departments.length} departments`).join("\n")}

Task: Review these confidence scores. Adjust any that seem wrong. Flag unreliable findings.`;

  logger.info({ companyName, preScoredCount: preScored.length }, "confidence scoring starting (LLM review)");

  const result = await client.analyzeStructured(CONFIDENCE_SCORING(companyName), userContent, {
    model: getConfig().llm.flashModel,
    maxTokens: config.maxTokensPerPass,
  });

  const llmFindings = result.findings || [];
  if (llmFindings.length > 0) {
    logger.info({ count: llmFindings.length }, "confidence scoring complete (LLM reviewed)");
    return llmFindings;
  }

  return preScored;
}

function preScoreFindings(
  entities: EntityExtractionResult,
  orgStructure: OrgStructureResult,
  departments: ClassifiedDepartment[],
  sources: StructuredCompanyData[]
): ScoredFinding[] {
  const findings: ScoredFinding[] = [];

  // Score people findings
  for (const person of entities.people) {
    const sourceData = sources.find((s) => person.source.includes(s.source) || s.source.includes(person.source));
    const sourceType = sourceData?.sourceType || "unknown";
    const confidence =
      sourceType === "linkedin"
        ? "direct"
        : sourceType === "crunchbase"
          ? "direct"
          : sourceType === "website"
            ? "direct"
            : "inferred";

    findings.push({
      statement: `${person.name} - ${person.title}`,
      category: "person",
      confidence,
      evidence: `Found via ${sourceType} source`,
      sources: [person.source],
    });
  }

  // Score department findings
  for (const dept of departments) {
    const peopleInDept = entities.people.filter(
      (p) => (p.department || "").toLowerCase() === dept.name.toLowerCase()
    );
    findings.push({
      statement: `${dept.name} department (${dept.function})${dept.head ? `, led by ${dept.head}` : ""}`,
      category: "department",
      confidence: dept.head ? "direct" : "inferred",
      evidence: `${peopleInDept.length} people identified in this department`,
      sources: [...new Set(peopleInDept.map((p) => p.source))],
    });
  }

  // Score structure findings
  for (const line of orgStructure.reportingLines) {
    findings.push({
      statement: `${line.person} reports to ${line.reportsTo}`,
      category: "structure",
      confidence: line.confidence,
      evidence: "Inferred from title hierarchy patterns",
      sources: [],
    });
  }

  return findings;
}

function getConfig() {
  const { getConfig } = require("../../config.js");
  return getConfig();
}
