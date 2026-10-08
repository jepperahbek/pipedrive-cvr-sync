import { env } from './env.ts';
import { createApp } from './app.ts';
import { buildAppConfig } from './server.ts';
import { isPipedriveConfigured } from './pipedrive/index.ts';

async function main(): Promise<void> {
  const config = await buildAppConfig();

  if (!isPipedriveConfigured()) {
    // eslint-disable-next-line no-console
    console.warn('[backend] Pipedrive not configured — sync disabled (CVR lookup still works)');
  } else if (!env.PIPEDRIVE_JWT_SECRET) {
    // eslint-disable-next-line no-console
    console.warn('[backend] PIPEDRIVE_JWT_SECRET not set — /api/sync is disabled');
  }

  const app = createApp(config);
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[backend] listening on :${env.PORT} (provider=${env.CVR_PROVIDER}, sync=${config.sync ? 'on' : 'off'}, oauth=${config.oauth ? 'on' : 'off'})`,
    );
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[backend] fatal during startup:', err);
  process.exit(1);
});
