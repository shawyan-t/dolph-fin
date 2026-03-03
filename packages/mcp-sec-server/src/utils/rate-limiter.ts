/**
 * Token bucket rate limiter for SEC EDGAR requests.
 * Max 10 requests per second as required by SEC.
 */

import { SEC_MAX_REQUESTS_PER_SECOND } from '@filinglens/shared';

export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per ms
  private lastRefill: number;
  private queue: Array<() => void> = [];

  constructor(maxPerSecond: number = SEC_MAX_REQUESTS_PER_SECOND) {
    this.maxTokens = maxPerSecond;
    this.tokens = maxPerSecond;
    this.refillRate = maxPerSecond / 1000;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Wait until a token is available
    const waitMs = Math.ceil((1 - this.tokens) / this.refillRate);
    return new Promise(resolve => {
      setTimeout(() => {
        this.refill();
        this.tokens -= 1;
        resolve();
      }, waitMs);
    });
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();
