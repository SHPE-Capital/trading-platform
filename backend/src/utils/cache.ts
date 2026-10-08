/**
 * utils/cache.ts
 *
 * Short-lived read cache for expensive or rate-limited reads: broker account
 * views (Alpaca allows 200 requests a minute per account) and performance
 * reports. In-process today — there is one API process per deployment. The
 * Cache interface is the seam for a shared store (Valkey/Redis) if the API is
 * ever scaled to several processes; nothing durable may live here.
 */

export interface Cache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs: number): void;
  delete(key: string): void;
  /** Returns the cached value, or loads, caches and returns it. Concurrent misses share one load. */
  getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T>;
}

export class MemoryCache implements Cache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly loading = new Map<string, Promise<unknown>>();

  constructor(private readonly maxEntries = 500, private readonly now: () => number = Date.now) {}

  get<T>(key: string): T | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  async getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(key);
    if (hit !== undefined) return hit;
    const inFlight = this.loading.get(key);
    if (inFlight) return inFlight as Promise<T>;
    const p = load().then((value) => {
      this.set(key, value, ttlMs);
      return value;
    }).finally(() => this.loading.delete(key));
    this.loading.set(key, p);
    return p;
  }
}

/** Process-wide cache shared by the controllers. */
export const sharedCache: Cache = new MemoryCache();
