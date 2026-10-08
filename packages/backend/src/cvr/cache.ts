import NodeCache from 'node-cache';
import type { CvrLookupResult, CvrProvider } from './provider.ts';

const TWENTY_FOUR_HOURS_SECONDS = 24 * 60 * 60;

/**
 * Decorator that caches only SUCCESSFUL lookups (found === true) for 24h,
 * keyed by CVR number. Not-found / quota results are never cached so they can
 * recover on the next request.
 */
export class CachedCvrProvider implements CvrProvider {
  readonly name: string;
  private readonly inner: CvrProvider;
  private readonly cache: NodeCache;

  constructor(inner: CvrProvider, ttlSeconds: number = TWENTY_FOUR_HOURS_SECONDS) {
    this.inner = inner;
    this.name = inner.name;
    this.cache = new NodeCache({ stdTTL: ttlSeconds, useClones: true });
  }

  async lookup(cvr: string): Promise<CvrLookupResult> {
    const cached = this.cache.get<CvrLookupResult>(cvr);
    if (cached) return cached;

    const result = await this.inner.lookup(cvr);
    if (result.found) {
      this.cache.set(cvr, result);
    }
    return result;
  }
}
