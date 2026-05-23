import { PhaseConfig } from "../config.js";

export const PHASE_CONFIGS: Record<"quick" | "standard" | "deep", PhaseConfig> = {
  quick: {
    maxSearches: 3,
    analysisPasses: 1,
    crossVerify: false,
    extraPages: false,
    maxTokensPerPass: 2048,
  },
  standard: {
    maxSearches: 6,
    analysisPasses: 3,
    crossVerify: true,
    extraPages: false,
    maxTokensPerPass: 4096,
  },
  deep: {
    maxSearches: 10,
    analysisPasses: 5,
    crossVerify: true,
    extraPages: true,
    maxTokensPerPass: 8192,
  },
};
