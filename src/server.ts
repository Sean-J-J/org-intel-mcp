#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { researchCompany } from "./pipeline/orchestrator.js";

const server = new McpServer({
  name: "org-intel-mcp",
  version: "2.0.0",
});

server.tool(
  "research-company",
  "Research a company's organizational structure, key departments, and identify the right decision-makers for a specific business need. Uses public web data from multiple search engines and AI reasoning.",
  {
    companyName: z.string().describe("The name of the company to research (e.g., 'Acme Corp')"),
    businessNeed: z
      .string()
      .optional()
      .describe(
        "Optional: The specific business need or product/service area to identify relevant decision-makers (e.g., 'cloud infrastructure procurement', 'HR software', 'marketing automation')"
      ),
    depth: z
      .enum(["quick", "standard", "deep"])
      .optional()
      .default("standard")
      .describe(
        "Research depth: quick = basic org overview (~3 sources), standard = detailed analysis (~6 sources, cross-verified), deep = comprehensive multi-source deep dive (~10 sources, full analysis pipeline)"
      ),
  },
  async ({ companyName, businessNeed, depth }) => {
    try {
      const report = await researchCompany({ companyName, businessNeed, depth });
      return {
        content: [{ type: "text", text: report }],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error researching ${companyName}: ${error?.message || String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Org Intel MCP server v2.0.0 running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
