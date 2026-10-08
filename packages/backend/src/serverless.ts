import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createApp } from './app.ts';
import { buildAppConfig } from './server.ts';

/**
 * Vercel serverless entry. The Express app is built once per warm instance and
 * reused; building it resolves the field map lazily (one Pipedrive call on a
 * cold start). On build failure the memo is cleared so the next request retries.
 */
let appPromise: Promise<Express> | null = null;

function getApp(): Promise<Express> {
  if (!appPromise) {
    appPromise = (async () => {
      const config = await buildAppConfig();
      return createApp(config);
    })().catch((err) => {
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  // An Express app is itself a (req, res) request listener.
  (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
