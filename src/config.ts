import { logger } from "./utils/logger.js";

export interface SearchConfig {
  tavilyApiKey: string | null;
  bingApiKey: string | null;
  searxngInstances: string[];
  timeoutMs: number;
  maxResultsPerQuery: number;
}

export interface BrowserConfig {
  headless: boolean;
  timeoutMs: number;
  maxConcurrentPages: number;
}

export interface PhaseConfig {
  maxSearches: number;
  analysisPasses: number;
  crossVerify: boolean;
  extraPages: boolean;
  maxTokensPerPass: number;
}

export interface PipelineConfig {
  quick: PhaseConfig;
  standard: PhaseConfig;
  deep: PhaseConfig;
}

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  proModel: string;
  flashModel: string;
  maxContextChars: number;
  maxRetries: number;
  retryDelayMs: number;
}

export interface CacheConfig {
  enabled: boolean;
  ttlSeconds: number;
  maxSizeBytes: number;
}

export interface AppConfig {
  search: SearchConfig;
  browser: BrowserConfig;
  pipeline: PipelineConfig;
  llm: LLMConfig;
  cache: CacheConfig;
}

function envOrNull(key: string): string | null {
  const val = process.env[key];
  return val && val.trim() ? val.trim() : null;
}

function buildSearchConfig(): SearchConfig {
  return {
    tavilyApiKey: envOrNull("TAVILY_API_KEY"),
    bingApiKey: envOrNull("BING_API_KEY"),
    searxngInstances: (envOrNull("SEARXNG_INSTANCES") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    timeoutMs: 20000,
    maxResultsPerQuery: 5,
  };
}

function buildPipelineConfig(): PipelineConfig {
  return {
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
}

function buildLLMConfig(): LLMConfig {
  const apiKey = envOrNull("DEEPSEEK_API_KEY");
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY environment variable is required");
  }
  return {
    apiKey,
    baseUrl: envOrNull("DEEPSEEK_BASE_URL") || "https://api.deepseek.com/v1",
    proModel: envOrNull("DEEPSEEK_PRO_MODEL") || "deepseek-v4-pro",
    flashModel: envOrNull("DEEPSEEK_FLASH_MODEL") || "deepseek-v4-flash",
    maxContextChars: 80000,
    maxRetries: 3,
    retryDelayMs: 1000,
  };
}

function buildCacheConfig(): CacheConfig {
  return {
    enabled: envOrNull("ORG_INTEL_NO_CACHE") === null,
    ttlSeconds: parseInt(envOrNull("ORG_INTEL_CACHE_TTL") || "3600", 10),
    maxSizeBytes: 50 * 1024 * 1024,
  };
}

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (_config) return _config;
  _config = {
    search: buildSearchConfig(),
    browser: {
      headless: envOrNull("PLAYWRIGHT_HEADLESS") !== "false",
      timeoutMs: parseInt(envOrNull("PLAYWRIGHT_TIMEOUT") || "30000", 10),
      maxConcurrentPages: 4,
    },
    pipeline: buildPipelineConfig(),
    llm: buildLLMConfig(),
    cache: buildCacheConfig(),
  };
  logger.info({ tavily: !!_config.search.tavilyApiKey, bing: !!_config.search.bingApiKey }, "config initialized");
  return _config;
}

export function getPhaseConfig(depth: "quick" | "standard" | "deep"): PhaseConfig {
  return getConfig().pipeline[depth];
}
