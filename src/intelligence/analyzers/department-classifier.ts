import { getDeepSeekClient } from "../client.js";
import { DEPARTMENT_CLASSIFICATION } from "../prompts.js";
import { EntityExtractionResult, OrgStructureResult, ClassifiedDepartment } from "../../types.js";
import { getPhaseConfig } from "../../config.js";
import { logger } from "../../utils/logger.js";

export async function classifyDepartments(
  entities: EntityExtractionResult,
  orgStructure: OrgStructureResult,
  companyName: string,
  depth: "quick" | "standard" | "deep"
): Promise<ClassifiedDepartment[]> {
  const config = getPhaseConfig(depth);
  const client = getDeepSeekClient();

  const userContent = `Company: ${companyName}

People:
${entities.people.map((p) => `- ${p.name}: ${p.title} (${p.department || "unknown department"})`).join("\n")}

Departments from data:
${entities.departments.map((d) => `- ${d.name} (Head: ${d.headName || "unknown"})`).join("\n")}

Reporting structure summary:
${orgStructure.hierarchySummary.slice(0, 3000)}

Task: Classify each person and department into the standard business function taxonomy.`;

  logger.info({ companyName }, "department classification starting");

  const text = await client.analyze(DEPARTMENT_CLASSIFICATION(companyName), userContent, {
    model: getConfig().llm.proModel,
    maxTokens: config.maxTokensPerPass,
    thinking: true,
  });

  const classified = parseClassifications(text, entities);

  logger.info({ classifiedCount: classified.length }, "department classification complete");
  return classified;
}

function parseClassifications(text: string, entities: EntityExtractionResult): ClassifiedDepartment[] {
  const result: ClassifiedDepartment[] = [];
  const functionKeywords: Record<string, ClassifiedDepartment["function"]> = {
    engineering: "engineering", engineer: "engineering", rnd: "engineering", "r&d": "engineering", software: "engineering", platform: "engineering", infrastructure: "engineering",
    sales: "sales", "business development": "sales", bd: "sales", revenue: "sales", account: "sales",
    marketing: "marketing", brand: "marketing", growth: "marketing", communications: "marketing", content: "marketing",
    product: "product", design: "product", ux: "product",
    finance: "finance", accounting: "finance", treasury: "finance", "fp&a": "finance", investor: "finance",
    hr: "hr", "human resources": "hr", people: "hr", talent: "hr", recruitment: "hr",
    legal: "legal", compliance: "legal", regulatory: "legal",
    operations: "operations", supply: "operations", logistics: "operations", facilities: "operations", it: "operations",
    executive: "executive", chief: "executive", ceo: "executive", cto: "executive", cfo: "executive", coo: "executive", cmo: "executive", president: "executive", founder: "executive", board: "executive",
  };

  // Classify each person
  for (const person of entities.people) {
    const title = (person.title || "").toLowerCase();
    const dept = (person.department || "").toLowerCase();
    const combined = `${title} ${dept}`;

    let func: ClassifiedDepartment["function"] = "other";
    for (const [keyword, classification] of Object.entries(functionKeywords)) {
      if (combined.includes(keyword)) {
        func = classification;
        break;
      }
    }

    // Group by department
    const deptName = person.department || func;
    let existing = result.find((d) => d.name.toLowerCase() === deptName.toLowerCase());
    if (!existing) {
      existing = { name: deptName, function: func, head: null, keyMembers: [], confidence: "inferred" };
      result.push(existing);
    }
    if (person.name) {
      existing.keyMembers.push(person.name);
      // If this person has a C-level or VP title, they're likely the head
      if (/chief|president|vp|svp|evp|head of|director/i.test(person.title || "")) {
        existing.head = existing.head || person.name;
      }
    }
  }

  return result;
}

function getConfig() {
  const { getConfig } = require("../../config.js");
  return getConfig();
}
