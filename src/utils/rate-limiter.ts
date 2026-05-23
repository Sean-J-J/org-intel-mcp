/**
 * Simple token-bucket rate limiter.
 */
export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private refillIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(maxTokens: number, refillPerMinute: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillPerMinute / (60000 / 1000);
    this.refillIntervalMs = 1000;
    this.startRefill();
  }

  private startRefill(): void {
    this.timer = setInterval(() => {
      this.tokens = Math.min(this.maxTokens, this.tokens + this.refillRate);
    }, this.refillIntervalMs);
  }

  async acquire(): Promise<void> {
    while (this.tokens < 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    this.tokens -= 1;
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export interface DomainRateLimiters {
  acquire: (domain: string) => Promise<void>;
  dispose: () => void;
}

export function createDomainRateLimiter(): DomainRateLimiters {
  const limiters = new Map<string, RateLimiter>();
  const defaults: Record<string, number> = {
    "linkedin.com": 10,
    "crunchbase.com": 15,
  };

  return {
    async acquire(domain: string) {
      let limiter = limiters.get(domain);
      if (!limiter) {
        const rpm = defaults[domain] || 30;
        limiter = new RateLimiter(rpm, rpm);
        limiters.set(domain, limiter);
      }
      await limiter.acquire();
    },
    dispose() {
      for (const limiter of limiters.values()) {
        limiter.dispose();
      }
      limiters.clear();
    },
  };
}
