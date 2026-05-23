import { getConfig } from "../config.js";
import { Browser, BrowserContext, Page } from "playwright";

interface PooledPage {
  page: Page;
  inUse: boolean;
  createdAt: number;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

export class BrowserPool {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: PooledPage[] = [];
  private maxPages: number;
  private headless: boolean;
  private idleTimeoutMs = 60000;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(maxPages = 4, headless = true) {
    this.maxPages = maxPages;
    this.headless = headless;
    this.cleanupTimer = setInterval(() => this.cleanupIdle(), 30000);
    process.on("exit", () => this.dispose());
    process.on("SIGINT", () => this.dispose());
    process.on("SIGTERM", () => this.dispose());
  }

  async getPage(): Promise<Page> {
    if (this.disposed) throw new Error("BrowserPool is disposed");

    for (const pooled of this.pages) {
      if (!pooled.inUse) {
        pooled.inUse = true;
        pooled.createdAt = Date.now();
        return pooled.page;
      }
    }

    if (this.pages.length < this.maxPages) {
      await this.ensureBrowser();
      const page = await this.createStealthedPage();
      const pooled: PooledPage = { page, inUse: true, createdAt: Date.now() };
      this.pages.push(pooled);
      return page;
    }

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      for (const pooled of this.pages) {
        if (!pooled.inUse) {
          pooled.inUse = true;
          pooled.createdAt = Date.now();
          return pooled.page;
        }
      }
    }
  }

  releasePage(page: Page): void {
    for (const pooled of this.pages) {
      if (pooled.page === page) {
        pooled.inUse = false;
        return;
      }
    }
  }

  private async createStealthedPage(): Promise<Page> {
    const page = await this.context!.newPage();

    // Hide automation signals — critical for LinkedIn
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      (window as any).chrome = { runtime: {} };
    });

    return page;
  }

  private async ensureBrowser(): Promise<void> {
    if (this.browser && this.browser.isConnected()) return;

    const { chromium } = await import("playwright");
    this.browser = await chromium.launch({
      headless: this.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--disable-features=BlockInsecurePrivateNetworkRequests",
      ],
    });

    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    this.context = await this.browser.newContext({
      userAgent: ua,
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
      timezoneId: "Asia/Riyadh",
      geolocation: { longitude: 46.6753, latitude: 24.7136 },
      permissions: [],
    });

    // Block trackers and heavy resources to speed up page loads
    await this.context.route(
      /(google-analytics|googletagmanager|facebook|doubleclick|hotjar|analytics|ad\.|tracker|pixel)\./i,
      (route) => route.abort()
    );
    // Block images on non-LinkedIn pages for speed
    await this.context.route(
      /\.(png|jpg|jpeg|gif|svg|webp|ico)(\?|$)/i,
      (route, request) => {
        if (request.url().includes("linkedin.com")) {
          route.continue();
        } else {
          route.abort();
        }
      }
    );
  }

  private cleanupIdle(): void {
    const now = Date.now();
    for (let i = this.pages.length - 1; i >= 0; i--) {
      const pooled = this.pages[i];
      if (!pooled.inUse && (now - pooled.createdAt) > this.idleTimeoutMs) {
        pooled.page.close().catch(() => {});
        this.pages.splice(i, 1);
      }
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const pooled of this.pages) {
      pooled.page.close().catch(() => {});
    }
    this.pages = [];
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

let _pool: BrowserPool | null = null;

export function getBrowserPool(): BrowserPool {
  if (!_pool) {
    const config = getConfig();
    _pool = new BrowserPool(config.browser.maxConcurrentPages, config.browser.headless);
  }
  return _pool;
}
