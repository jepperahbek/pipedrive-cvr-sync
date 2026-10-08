import { env } from './env.ts';
import type { AppConfig, SyncConfig } from './app.ts';
import type { OAuthConfig } from './routes/oauth.ts';
import { getCvrProvider } from './cvr/index.ts';
import { getPipedriveClient, isPipedriveConfigured, resolveFieldMap } from './pipedrive/index.ts';

/**
 * Build the sync configuration (Pipedrive deps + optional JWT). Returns
 * undefined when Pipedrive isn't configured (only public CVR lookup then).
 * The webhook (auto-sync) needs just the API token + webhook creds; the iframe
 * panel routes additionally require PIPEDRIVE_JWT_SECRET. Field map is lazy/memoized.
 */
export async function buildSyncConfig(): Promise<SyncConfig | undefined> {
  if (!isPipedriveConfigured()) return undefined;
  const fieldMap = await resolveFieldMap();
  return {
    jwtSecret: env.PIPEDRIVE_JWT_SECRET,
    expectedCompanyId: env.PIPEDRIVE_COMPANY_ID,
    deps: {
      cvrProvider: getCvrProvider(),
      pipedrive: getPipedriveClient(),
      fieldMap,
    },
    webhookAuth: {
      user: env.PIPEDRIVE_WEBHOOK_USER,
      password: env.PIPEDRIVE_WEBHOOK_PASSWORD,
    },
  };
}

/** OAuth install-callback config — present only when client credentials are set. */
export function buildOAuthConfig(): OAuthConfig | undefined {
  if (!env.PIPEDRIVE_CLIENT_ID || !env.PIPEDRIVE_CLIENT_SECRET) return undefined;
  return {
    clientId: env.PIPEDRIVE_CLIENT_ID,
    clientSecret: env.PIPEDRIVE_CLIENT_SECRET,
    redirectUri: env.PIPEDRIVE_OAUTH_REDIRECT_URI,
  };
}

/** Assemble the full app config shared by the local server and the serverless handler. */
export async function buildAppConfig(): Promise<AppConfig> {
  return {
    sync: await buildSyncConfig(),
    oauth: buildOAuthConfig(),
  };
}
