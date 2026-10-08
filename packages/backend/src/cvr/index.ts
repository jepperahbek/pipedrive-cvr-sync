import { env } from '../env.ts';
import type { CvrProvider } from './provider.ts';
import { DatafordelerProvider } from './datafordeler.ts';
import { CachedCvrProvider } from './cache.ts';

export type { CvrProvider, CvrCompany, CvrLookupResult, CvrWarning, CvrStatus } from './provider.ts';

/**
 * Provider factory. Selects the adapter from CVR_PROVIDER and wraps it in the
 * 24h cache. Datafordeler GraphQL is the sole supported source (official CVR).
 */
export function createCvrProvider(): CvrProvider {
  let base: CvrProvider;

  switch (env.CVR_PROVIDER) {
    case 'datafordeler':
      base = new DatafordelerProvider({
        apiKey: env.DATAFORDELER_API_KEY!,
        endpoint: env.DATAFORDELER_GRAPHQL_URL,
      });
      break;
    default:
      throw new Error(`Unknown CVR_PROVIDER: ${env.CVR_PROVIDER}`);
  }

  return new CachedCvrProvider(base);
}

// Process-lifetime singleton.
let provider: CvrProvider | null = null;
export function getCvrProvider(): CvrProvider {
  if (!provider) provider = createCvrProvider();
  return provider;
}
