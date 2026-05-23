import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getConfig } from "../config.js";
import { logger } from "./logger.js";

const CACHE_DIR = path.join(process.env.HOME || "/tmp", ".org-intel-cache");

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheKey(data: string): string {
  return crypto.createHash("md5").update(data).digest("hex");
}

function cachePath(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`);
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export function cacheGet<T>(cacheId: string): T | null {
  const config = getConfig();
  if (!config.cache.enabled) return null;

  try {
    ensureCacheDir();
    const filePath = cachePath(cacheKey(cacheId));
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const entry: CacheEntry<T> = JSON.parse(raw);
    const age = (Date.now() - entry.timestamp) / 1000;
    if (age > entry.ttl) {
      fs.unlinkSync(filePath);
      return null;
    }
    logger.debug({ cacheId: cacheId.slice(0, 60) }, "cache hit");
    return entry.data;
  } catch {
    return null;
  }
}

export function cacheSet<T>(cacheId: string, data: T, ttlSeconds?: number): void {
  const config = getConfig();
  if (!config.cache.enabled) return;

  try {
    ensureCacheDir();
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttlSeconds || config.cache.ttlSeconds,
    };
    fs.writeFileSync(cachePath(cacheKey(cacheId)), JSON.stringify(entry));
    logger.debug({ cacheId: cacheId.slice(0, 60) }, "cache set");
  } catch {
    logger.warn({ cacheId: cacheId.slice(0, 60) }, "cache write failed");
  }
}

export function cacheClear(): void {
  try {
    if (fs.existsSync(CACHE_DIR)) {
      for (const file of fs.readdirSync(CACHE_DIR)) {
        fs.unlinkSync(path.join(CACHE_DIR, file));
      }
    }
    logger.info("cache cleared");
  } catch {
    // ignore
  }
}
