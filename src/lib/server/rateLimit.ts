import { createHash } from 'node:crypto';
import { limitsConfig } from './config';
import { ApiFailure } from './http';

/**
 * Abuse and cost controls for the paid endpoints.
 *
 * Two counters are checked before any provider call:
 *   1. per client, per endpoint, per minute;
 *   2. all clients, all paid endpoints, per UTC day (a hard spend ceiling).
 *
 * Counters live in a shared Redis REST store when one is configured, which is
 * what makes the limits hold across Cloud Run instances. Without it the
 * counters are per instance, so the effective ceiling is (limit x instances);
 * the deployment bounds that with `--max-instances`.
 */

export interface CounterStore {
  readonly kind: 'shared' | 'per-instance';
  /** Increment `key`, creating it with the given lifetime, and return the new count. */
  increment(key: string, ttlSeconds: number): Promise<number>;
}

export class MemoryStore implements CounterStore {
  readonly kind = 'per-instance' as const;
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const t = this.now();
    if (this.entries.size > 5000) {
      for (const [k, v] of this.entries) if (v.expiresAt <= t) this.entries.delete(k);
    }
    const existing = this.entries.get(key);
    if (!existing || existing.expiresAt <= t) {
      this.entries.set(key, { count: 1, expiresAt: t + ttlSeconds * 1000 });
      return 1;
    }
    existing.count += 1;
    return existing.count;
  }
}

/** Upstash-compatible Redis REST API, called with `fetch` so no client library is needed. */
export class RedisRestStore implements CounterStore {
  readonly kind = 'shared' as const;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const response = await this.fetchImpl(`${this.url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, String(ttlSeconds), 'NX'],
      ]),
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) throw new Error(`Counter store returned ${response.status}`);
    const data: unknown = await response.json();
    const count = Array.isArray(data) ? (data[0] as { result?: unknown } | undefined)?.result : undefined;
    if (typeof count !== 'number') throw new Error('Counter store returned an unexpected body');
    return count;
  }
}

let memory: MemoryStore | undefined;
function memoryStore(): MemoryStore {
  memory ??= new MemoryStore();
  return memory;
}

export function getStore(): CounterStore {
  const { redisUrl, redisToken } = limitsConfig();
  return redisUrl && redisToken ? new RedisRestStore(redisUrl, redisToken) : memoryStore();
}

/** For tests. */
export function resetMemoryStore(): void {
  memory = undefined;
}

/**
 * The client address as seen by the outermost trusted proxy. Each trusted
 * proxy appends one entry to X-Forwarded-For, so entries to the left of the
 * trusted ones are client-controlled and are ignored.
 */
export function clientAddress(request: Request, trustedProxyHops: number): string {
  const parts = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const index = parts.length - 1 - trustedProxyHops;
  return parts[index] ?? parts[0] ?? 'unknown';
}

/** One-way hash so raw addresses are never stored in the counter store. */
function clientKey(address: string, day: string): string {
  return createHash('sha256').update(`${day}:${address}`).digest('hex').slice(0, 24);
}

export type PaidBucket = 'chat' | 'tts' | 'understand';

export async function enforceLimits(
  request: Request,
  bucket: PaidBucket,
  deps: { store?: CounterStore; now?: () => number } = {},
): Promise<void> {
  const config = limitsConfig();
  const now = (deps.now ?? Date.now)();
  const day = new Date(now).toISOString().slice(0, 10);
  const minute = Math.floor(now / 60_000);
  const client = clientKey(clientAddress(request, config.trustedProxyHops), day);

  const count = async (key: string, ttl: number): Promise<number> => {
    const store = deps.store ?? getStore();
    try {
      return await store.increment(key, ttl);
    } catch {
      // The shared store is down: keep limiting on this instance rather than failing open.
      return memoryStore().increment(key, ttl);
    }
  };

  const perClient = await count(`sakho:rl:${bucket}:${client}:${minute}`, 90);
  if (perClient > config.perMinute) {
    throw new ApiFailure('rate_limited', 'Too many requests. Please wait a minute.', 60);
  }
  const daily = await count(`sakho:budget:${day}`, 60 * 60 * 26);
  if (daily > config.dailyCap) {
    throw new ApiFailure('budget_exhausted', 'The daily usage limit has been reached. Try again tomorrow.');
  }
}
