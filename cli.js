#!/usr/bin/env node
// CLI wrapper for OpenClaw - bypasses MCP protocol, calls the core logic directly
// Usage: node cli.js <companyName> [businessNeed] [depth=standard]
// Example: node cli.js "Mastercard" "payment gateway partnership" deep

import { researchCompany } from "./dist/orgIntelligence.js";

const args = process.argv.slice(2);
const companyName = args[0];
const businessNeed = args[1];
const depth = (args[2] || "standard");

if (!companyName) {
  console.error("Usage: node cli.js <companyName> [businessNeed] [depth=quick|standard|deep]");
  process.exit(1);
}

const report = await researchCompany({ companyName, businessNeed, depth });
console.log(report);
