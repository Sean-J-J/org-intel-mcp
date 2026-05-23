import { getDeepSeekClient } from "../client.js";
import { ENTITY_EXTRACTION } from "../prompts.js";
import { EntityExtractionResult, StructuredCompanyData } from "../../types.js";
import { allocateContextBudget, estimateTokenCount } from "../../utils/text.js";
import { getPhaseConfig, getConfig } from "../../config.js";
import { logger } from "../../utils/logger.js";

export async function extractEntities(
  companyName: string,
  sources: StructuredCompanyData[],
  depth: "quick" | "standard" | "deep"
): Promise<EntityExtractionResult> {
  const config = getPhaseConfig(depth);
  const client = getDeepSeekClient();

  // Build context from sources, prioritizing structured data over raw text
  const contextSources = sources.map((s, i) => ({
    key: `source_${i}_${s.sourceType}`,
    text: `Source (${s.sourceType}): ${s.source}\n\nRaw people found: ${JSON.stringify(s.people)}\nDepartments: ${JSON.stringify(s.departments)}\nCompany info: ${JSON.stringify({name: s.companyName, industry: s.industry, size: s.companySize, founded: s.founded, hq: s.headquarters, description: s.description})}\n\nRaw text:\n${s.rawText.slice(0, 5000)}`,
    priority: s.sourceType === "linkedin" ? 5 : s.sourceType === "crunchbase" ? 4 : s.sourceType === "website" ? 3 : 1,
  }));

  const budgeted = allocateContextBudget(contextSources, config.maxTokensPerPass * 2);
  const userContent = budgeted.map((b) => b.text).join("\n\n---\n\n");

  logger.info(
    { companyName, sourceCount: sources.length, inputTokens: estimateTokenCount(userContent) },
    "entity extraction starting"
  );

  const result = await client.analyzeStructured(ENTITY_EXTRACTION(companyName), userContent, {
    model: getConfig().llm.flashModel,
    maxTokens: config.maxTokensPerPass,
  });

  logger.info({ peopleCount: result.people?.length || 0, deptCount: result.departments?.length || 0 }, "entity extraction complete");

  return {
    people: result.people || [],
    departments: result.departments || [],
    locations: result.locations || [],
    companyInfo: result.companyInfo || { name: null, industry: null, size: null, founded: null, headquarters: null, description: null },
  };
}

