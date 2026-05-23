import { getDeepSeekClient } from "../client.js";
import { ORG_STRUCTURE } from "../prompts.js";
import { EntityExtractionResult, OrgStructureResult } from "../../types.js";
import { getPhaseConfig, getConfig } from "../../config.js";
import { logger } from "../../utils/logger.js";

export async function analyzeOrgStructure(
  entities: EntityExtractionResult,
  companyName: string,
  depth: "quick" | "standard" | "deep"
): Promise<OrgStructureResult> {
  const config = getPhaseConfig(depth);
  const client = getDeepSeekClient();

  const userContent = `Company: ${companyName}

Extracted Entities:
${JSON.stringify(entities, null, 2)}

Task: Reconstruct the organizational structure from this data. Identify reporting relationships, team structures, and overall hierarchy.`;

  logger.info({ companyName, peopleCount: entities.people.length }, "org structure analysis starting");

  const text = await client.analyze(ORG_STRUCTURE(companyName, depth), userContent, {
    model: getConfig().llm.proModel,
    maxTokens: config.maxTokensPerPass,
    thinking: true,
  });

  // Extract structured content from the narrative analysis
  const reportingLines = extractReportingLines(text);
  const teams = extractTeams(text);

  logger.info({ reportingLines: reportingLines.length, teams: teams.length }, "org structure analysis complete");

  return {
    reportingLines,
    teams,
    hierarchySummary: text,
  };
}

function extractReportingLines(text: string): OrgStructureResult["reportingLines"] {
  const lines: OrgStructureResult["reportingLines"] = [];
  // Pattern: "X reports to Y" or "X → Y"
  const pattern = /([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})\s+(?:reports to|→|->)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,3})/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    lines.push({
      person: match[1].trim(),
      reportsTo: match[2].trim(),
      confidence: "inferred",
    });
  }
  return lines;
}

function extractTeams(text: string): OrgStructureResult["teams"] {
  const teams: OrgStructureResult["teams"] = [];
  // Pattern: "X team/department is led by Y"
  const pattern = /([A-Z][a-z]+(?:\s[A-Z][a-z]+)?(?:\s(?:Team|Department|Division|Group)))\s+(?:is\s+)?(?:led by|headed by|managed by)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,3})/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    teams.push({
      name: match[1].trim(),
      lead: match[2].trim(),
      members: [],
      function: "",
    });
  }
  return teams;
}

