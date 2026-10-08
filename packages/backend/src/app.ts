import express, { type Express } from 'express';
import { healthRouter } from './routes/health.ts';
import { cvrRouter } from './routes/cvr.ts';
import { createSyncRouter, type SyncDeps } from './routes/sync.ts';
import { createOrgRouter } from './routes/org.ts';
import { createWebhookRouter, type WebhookAuth } from './routes/webhook.ts';
import { createOAuthRouter, type OAuthConfig } from './routes/oauth.ts';
import { verifyPipedriveJwt } from './middleware/verifyJwt.ts';
import { createRateLimiter } from './middleware/rateLimit.ts';

export interface SyncConfig {
  /** Required only for the iframe panel routes (sync, org read). The webhook
   *  uses Basic auth and works without it. */
  jwtSecret?: string;
  expectedCompanyId?: number;
  deps: SyncDeps;
  /** HTTP Basic auth for the Pipedrive webhook (server-to-server). Both user
   *  and password are required — the webhook is not mounted without them. */
  webhookAuth?: WebhookAuth;
}

export interface AppConfig {
  /** When provided, mounts the authenticated routes (sync, org read, webhook). */
  sync?: SyncConfig;
  /** When provided, mounts the public OAuth install-callback route. */
  oauth?: OAuthConfig;
}

/** Build the Express app (no listen). Pass sync config to enable the write routes. */
export function createApp(config: AppConfig = {}): Express {
  const app = express();
  app.use(express.json());

  app.use('/', healthRouter);
  // Public CVR lookup is rate-limited to protect each deployer's Datafordeler key.
  app.use('/api', createRateLimiter({ windowMs: 60_000, max: 60 }), cvrRouter);

  // Public OAuth install-callback (no JWT) — finalizes the app installation.
  if (config.oauth) {
    app.use('/api/oauth', createOAuthRouter(config.oauth));
  }

  if (config.sync) {
    const { jwtSecret, expectedCompanyId, deps, webhookAuth } = config.sync;
    // Panel routes need the iframe JWT; mounted only when the secret is set.
    if (jwtSecret) {
      const jwt = verifyPipedriveJwt({ secret: jwtSecret, expectedCompanyId });
      app.use('/api/sync', jwt, createSyncRouter(deps));
      app.use('/api/org', jwt, createOrgRouter({ pipedrive: deps.pipedrive, fieldMap: deps.fieldMap }));
    }
    // Webhook is fail-closed: only mounted when Basic auth credentials are set.
    if (webhookAuth?.user && webhookAuth?.password) {
      app.use('/api/webhook', createWebhookRouter(deps, webhookAuth));
    }
  }

  return app;
}
