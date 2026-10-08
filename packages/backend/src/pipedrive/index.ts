import { env } from '../env.ts';
import { PipedriveClient } from './client.ts';
import { setupOrganizationFields, type ResolvedFieldMap } from './fields.ts';

export { PipedriveClient, PipedriveApiError } from './client.ts';
export type { ResolvedFieldMap, ResolvedField } from './fields.ts';

let client: PipedriveClient | null = null;
let fieldMapPromise: Promise<ResolvedFieldMap> | null = null;

/** Process-lifetime Pipedrive client. Throws if the token/domain are unset. */
export function getPipedriveClient(): PipedriveClient {
  if (!client) {
    if (!env.PIPEDRIVE_API_TOKEN || !env.PIPEDRIVE_COMPANY_DOMAIN) {
      throw new Error(
        'Pipedrive is not configured (set PIPEDRIVE_API_TOKEN and PIPEDRIVE_COMPANY_DOMAIN)',
      );
    }
    client = new PipedriveClient({
      apiToken: env.PIPEDRIVE_API_TOKEN,
      companyDomain: env.PIPEDRIVE_COMPANY_DOMAIN,
    });
  }
  return client;
}

/**
 * Resolve (and create-if-missing) the custom fields, memoized for the lifetime
 * of the process/serverless instance. The first call within an instance does
 * the work (one listOrganizationFields call); subsequent calls reuse it. On
 * failure the memo is cleared so the next request retries.
 */
export function resolveFieldMap(): Promise<ResolvedFieldMap> {
  if (!fieldMapPromise) {
    fieldMapPromise = setupOrganizationFields(getPipedriveClient())
      .then((summary) => {
        // eslint-disable-next-line no-console
        console.log(`[pipedrive] resolved ${summary.resolved} fields, created ${summary.created}`);
        return summary.map;
      })
      .catch((err) => {
        fieldMapPromise = null; // allow retry on next request
        throw err;
      });
  }
  return fieldMapPromise;
}

export function isPipedriveConfigured(): boolean {
  return Boolean(env.PIPEDRIVE_API_TOKEN && env.PIPEDRIVE_COMPANY_DOMAIN);
}
