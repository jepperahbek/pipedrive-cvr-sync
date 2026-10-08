import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    CVR_PROVIDER: z.enum(['datafordeler']).default('datafordeler'),
    // Required by Datafordeler GraphQL. Create an IT-system + API key at
    // https://datafordeler.dk (Administration). Free for non-CVRPerson entities.
    DATAFORDELER_API_KEY: z.string().optional(),
    // Optional override of the GraphQL endpoint (tests / staging mirrors).
    DATAFORDELER_GRAPHQL_URL: z.string().url().optional(),

    // Pipedrive — optional so the app can run as a pure CVR lookup service.
    PIPEDRIVE_API_TOKEN: z.string().optional(),
    PIPEDRIVE_COMPANY_DOMAIN: z.string().optional(),
    PIPEDRIVE_JWT_SECRET: z.string().optional(),
    // Expected Pipedrive company id; if set, the iframe JWT's company id must match
    // (rejects tokens minted for any other Pipedrive company). Single-tenant guard.
    PIPEDRIVE_COMPANY_ID: z.coerce.number().int().positive().optional(),
    // HTTP Basic auth for the Pipedrive webhook (auto-sync). Set the same values
    // when creating the webhook in Pipedrive.
    PIPEDRIVE_WEBHOOK_USER: z.string().optional(),
    PIPEDRIVE_WEBHOOK_PASSWORD: z.string().optional(),
    // OAuth client credentials (Developer Hub). Used ONLY to complete the app
    // install handshake so UI extensions activate — tokens are not stored; data
    // still uses PIPEDRIVE_API_TOKEN.
    PIPEDRIVE_CLIENT_ID: z.string().optional(),
    PIPEDRIVE_CLIENT_SECRET: z.string().optional(),
    // Optional explicit OAuth redirect URI; otherwise derived from the request host.
    PIPEDRIVE_OAUTH_REDIRECT_URI: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.CVR_PROVIDER === 'datafordeler' && !val.DATAFORDELER_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATAFORDELER_API_KEY'],
        message:
          'DATAFORDELER_API_KEY is required (create an IT-system API key at datafordeler.dk)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const env = loadEnv();
