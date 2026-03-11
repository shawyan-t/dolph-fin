/**
 * Token bucket rate limiter for SEC EDGAR requests.
 * Max 10 requests per second as required by SEC.
 *
 * Properly serializes concurrent acquire() calls to prevent
 * the bucket from going negative under load.
 */

import { SEC_MAX_REQUESTS_PER_SECOND } from '@shawyan/shared';

export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per ms
  private lastRefill: number;
  private pending: Array<() => void> = [];
  private draining = false;

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

  /**
   * Acquire a token. Serialized: only one caller proceeds at a time,
   * preventing the bucket from going negative under concurrent load.
   */
  async acquire(): Promise<void> {
    return new Promise<void>(resolve => {
      this.pending.push(resolve);
      this.drain();
    });
  }

  private drain(): void {
    if (this.draining) return;
    this.draining = true;

    const processNext = () => {
      if (this.pending.length === 0) {
        this.draining = false;
        return;
      }

      this.refill();

      if (this.tokens >= 1) {
        this.tokens -= 1;
        const resolve = this.pending.shift()!;
        resolve();
        // Process next immediately (synchronously) to batch available tokens
        processNext();
      } else {
        // Wait until a token is available, then continue draining
        const waitMs = Math.ceil((1 - this.tokens) / this.refillRate);
        setTimeout(() => {
          processNext();
        }, waitMs);
      }
    };

    processNext();
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();
