import { getDeepSeekClient } from "./client.js";
import { ScoredFinding, VerifiedFindings, StructuredCompanyData } from "../types.js";
import { getPhaseConfig, getConfig } from "../config.js";
import { logger } from "../utils/logger.js";

export async function crossVerify(
  findings: ScoredFinding[],
  sources: StructuredCompanyData[],
  companyName: string,
  depth: "quick" | "standard" | "deep"
): Promise<VerifiedFindings> {
  if (sources.length < 2) {
    return { consensus: findings, discrepancies: [], summary: "Single source — no cross-verification possible." };
  }

  const config = getPhaseConfig(depth);
  const client = getDeepSeekClient();

  // Algorithmic: group findings by person name, check for conflicts
  const personFindings = findings.filter((f) => f.category === "person");
  const byPerson = new Map<string, ScoredFinding[]>();
  for (const f of personFindings) {
    const name = f.statement.split(" - ")[0].toLowerCase();
    if (!byPerson.has(name)) byPerson.set(name, []);
    byPerson.get(name)!.push(f);
  }

  const discrepancies: VerifiedFindings["discrepancies"] = [];
  const consensus: ScoredFinding[] = [];

  // Check for conflicts: same person, different titles across sources
  for (const [name, personFindings] of byPerson) {
    if (personFindings.length === 1) {
      consensus.push(personFindings[0]);
      continue;
    }

    const titles = new Set(personFindings.map((f) => f.statement));
    if (titles.size === 1) {
      // Consensus — same info from multiple sources
      consensus.push({ ...personFindings[0], confidence: "direct" });
    } else {
      // Discrepancy — different titles from different sources
      for (let i = 1; i < personFindings.length; i++) {
        discrepancies.push({
          finding1: personFindings[0],
          finding2: personFindings[i],
          resolution: "",
        });
      }
      // Take the most recent source's version
      consensus.push(personFindings[0]);
    }
  }

  // Non-person findings go straight to consensus
  for (const f of findings) {
    if (f.category !== "person") {
      consensus.push(f);
    }
  }

  // If discrepancies found, use LLM to resolve
  if (discrepancies.length > 0 && depth !== "quick") {
    logger.info({ discrepancies: discrepancies.length }, "cross-verification using LLM");

    const userContent = `Company: ${companyName}
Discrepancies found across sources:

${discrepancies.map((d, i) => `
Discrepancy ${i + 1}:
  Source A says: ${d.finding1.statement} (${d.finding1.confidence}) — from ${d.finding1.sources[0] || "unknown"}
  Source B says: ${d.finding2.statement} (${d.finding2.confidence}) — from ${d.finding2.sources[0] || "unknown"}
`).join("\n")}

Source types: ${sources.map((s) => s.sourceType).join(", ")}
Task: For each discrepancy, explain which version is more likely correct and why.`;

    try {
      const text = await client.analyze(
        "You are a data verification specialist. Resolve conflicts between different sources of organizational data.",
        userContent,
        { model: getConfig().llm.flashModel, maxTokens: 2048, thinking: false }
      );

      // Parse resolutions
      let idx = 0;
      const resolutionRegex = /(?:discrepancy\s*\d|resolution)\s*[:.-]\s*(.+)/gi;
      let match;
      while ((match = resolutionRegex.exec(text)) !== null && idx < discrepancies.length) {
        discrepancies[idx].resolution = match[1].trim();
        idx++;
      }
    } catch (err: any) {
      logger.warn({ error: err.message }, "LLM discrepancy resolution failed");
    }
  }

  const summary = sources.length >= 2
    ? `Cross-verified across ${sources.length} sources (${sources.map((s) => s.sourceType).join(", ")}). ${consensus.length} consensus findings, ${discrepancies.length} discrepancies.`
    : "Single source — no cross-verification possible.";

  logger.info({ consensusCount: consensus.length, discrepancyCount: discrepancies.length }, "cross-verification complete");

  return { consensus, discrepancies, summary };
}

