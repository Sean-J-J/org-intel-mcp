import { getDeepSeekClient } from "../client.js";
import { DECISION_MAPPING } from "../prompts.js";
import { ScoredFinding, DecisionMap, StructuredCompanyData } from "../../types.js";
import { getPhaseConfig, getConfig } from "../../config.js";
import { logger } from "../../utils/logger.js";

export async function mapDecisionAuthority(
  companyName: string,
  businessNeed: string,
  scoredFindings: ScoredFinding[],
  sources: StructuredCompanyData[],
  depth: "quick" | "standard" | "deep"
): Promise<DecisionMap> {
  const config = getPhaseConfig(depth);
  const client = getDeepSeekClient();

  const userContent = `Company: ${companyName}
Business Need: ${businessNeed}

Organizational Intelligence (confidence-scored):
${scoredFindings.map((f) => `[${f.confidence.toUpperCase()}] ${f.statement} — ${f.evidence}`).join("\n")}

Source Summary:
${sources.map((s) => `${s.sourceType}: ${s.source} (${s.people.length} people, ${s.departments.length} departments, industry: ${s.industry}, size: ${s.companySize})`).join("\n")}

Company Info: ${sources[0]?.description || "N/A"}

Task: Map the best decision-makers and entry strategy for this business need.`;

  logger.info({ companyName, businessNeed }, "decision mapping starting");

  const text = await client.analyze(DECISION_MAPPING(), userContent, {
    model: getConfig().llm.proModel,
    maxTokens: config.maxTokensPerPass,
    thinking: true,
  });

  // Parse the narrative into structured sections
  const result = parseDecisionMap(text);

  logger.info(
    { decisionMakers: result.keyDecisionMakers.length, department: result.primaryDepartment },
    "decision mapping complete"
  );

  return result;
}

function parseDecisionMap(text: string): DecisionMap {
  const sections = extractSections(text);

  return {
    primaryDepartment: sections["primary department"] || sections["1"] || "Unknown",
    keyDecisionMakers: parseDecisionMakers(sections),
    decisionProcess: sections["decision process"] || sections["3"] || text.slice(0, 500),
    budgetAuthority: sections["budget authority"] || sections["5"] || "Unknown",
    entryStrategy: sections["entry strategy"] || sections["6"] || "No specific strategy identified",
    potentialObjections: parseObjections(sections),
    alternativeContacts: parseAlternatives(sections),
  };
}

function extractSections(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const sectionRegex = /(?:^|\n)(?:#{1,3}\s*)?(\d+\.\s*)?([A-Z][A-Za-z\s]+?)[：:]?\s*\n([\s\S]*?)(?=\n(?:#{1,3}\s*)?(?:\d+\.\s*)?[A-Z][A-Za-z\s]+?[：:]?\s*\n|$)/g;
  let match;
  while ((match = sectionRegex.exec(text)) !== null) {
    const key = match[2].toLowerCase().trim();
    result[key] = match[3].trim();
  }

  // If no sections found, use the whole text
  if (Object.keys(result).length === 0) {
    result["full"] = text;
  }

  return result;
}

function parseDecisionMakers(sections: Record<string, string>): DecisionMap["keyDecisionMakers"] {
  const text = sections["key decision-makers"] || sections["2"] || "";
  if (!text) return [];

  const result: DecisionMap["keyDecisionMakers"] = [];
  const lines = text.split(/\n/);
  for (const line of lines) {
    const match = line.match(/(?:^|\s)[-*]\s*(.+?)(?:[-–]\s*(.+))?$/);
    if (match) {
      const role = match[1].trim();
      const detail = (match[2] || "").toLowerCase();
      result.push({
        role,
        influence: detail.includes("decision") ? "decision-maker" : detail.includes("influenc") ? "influencer" : "gatekeeper",
        confidence: "inferred",
      });
    }
  }

  return result;
}

function parseObjections(sections: Record<string, string>): DecisionMap["potentialObjections"] {
  const text = sections["potential objections"] || sections["7"] || "";
  if (!text) return [];

  const result: DecisionMap["potentialObjections"] = [];
  const lines = text.split(/\n/);
  for (const line of lines) {
    const match = line.match(/(?:^|\s)[-*]\s*(.+?):\s*(.+)/);
    if (match) {
      result.push({
        stakeholder: match[1].trim(),
        concern: match[2].trim(),
        mitigation: "",
      });
    }
  }

  return result;
}

function parseAlternatives(sections: Record<string, string>): string[] {
  const text = sections["alternative contacts"] || sections["8"] || "";
  if (!text) return [];

  return text
    .split(/\n/)
    .filter((l) => l.match(/^\s*[-*]\s/))
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

