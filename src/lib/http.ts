import { logger } from './logger.js';

interface RateLimiter {
  acquire(): Promise<void>;
}

function makeRateLimiter(maxPerWindow: number, windowMs: number): RateLimiter {
  let tokens = maxPerWindow;
  let lastRefill = Date.now();

  return {
    async acquire() {
      const now = Date.now();
      const elapsed = now - lastRefill;
      if (elapsed >= windowMs) {
        tokens = maxPerWindow;
        lastRefill = now;
      }
      if (tokens <= 0) {
        const wait = windowMs - elapsed;
        await sleep(wait);
        tokens = maxPerWindow;
        lastRefill = Date.now();
      }
      tokens--;
    },
  };
}

const limiters: Record<string, RateLimiter> = {
  'services.leadconnectorhq.com': makeRateLimiter(100, 10_000),
};

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 5,
): Promise<Response> {
  const host = new URL(url).hostname;
  const limiter = limiters[host];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (limiter) await limiter.acquire();

    const res = await fetch(url, options);

    logger.info('http', { url, status: res.status, attempt });

    if (res.ok) return res;

    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxRetries) throw new Error(`HTTP ${res.status} after ${maxRetries} retries: ${url}`);
      const backoff = Math.min(1000 * 2 ** attempt + Math.random() * 500, 30_000);
      logger.warn('retrying', { url, status: res.status, backoffMs: Math.round(backoff) });
      await sleep(backoff);
      continue;
    }

    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${url}\n${body}`);
  }

  throw new Error('unreachable');
}
