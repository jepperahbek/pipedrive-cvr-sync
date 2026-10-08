import { Router } from 'express';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Must match the callback URL registered in the Developer Hub. Derived from
   *  the request host when not set. */
  redirectUri?: string;
}

export type FetchFn = typeof fetch;

const TOKEN_URL = 'https://oauth.pipedrive.com/oauth/token';

function page(title: string, message: string): string {
  return `<!doctype html><html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;min-height:100vh;
align-items:center;justify-content:center;margin:0;background:#f7f8fa;color:#21253b}
.card{background:#fff;border:1px solid #e3e5eb;border-radius:12px;padding:28px 32px;max-width:440px;text-align:center}
h1{font-size:18px;margin:0 0 8px}p{color:#6b7280;font-size:14px;margin:0;line-height:1.5}
</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

/**
 * GET /callback (mounted at /api/oauth)
 *
 * Completes the Pipedrive app-install OAuth handshake: exchanges the
 * authorization code for a token so the installation finalizes and the app's
 * UI extensions (panel/modal) activate. The token is intentionally NOT stored —
 * all data operations use the personal API token.
 */
export function createOAuthRouter(cfg: OAuthConfig, fetchFn: FetchFn = fetch): Router {
  const router = Router();

  router.get('/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    if (!code) {
      return res
        .status(400)
        .send(page('Installation mislykkedes', 'Manglende autorisationskode fra Pipedrive.'));
    }

    const redirectUri = cfg.redirectUri ?? `https://${req.get('host')}/api/oauth/callback`;
    const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    try {
      const tokenRes = await fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      if (!tokenRes.ok) {
        return res
          .status(502)
          .send(page('Installation mislykkedes', `Pipedrive afviste token-udvekslingen (${tokenRes.status}).`));
      }
      // Success — installation finalized. We do not persist the tokens.
      return res.send(
        page('CVR Sync er installeret 🎉', 'Du kan lukke dette vindue og åbne en organisation i Pipedrive.'),
      );
    } catch {
      return res
        .status(502)
        .send(page('Installation mislykkedes', 'Kunne ikke kontakte Pipedrive. Prøv igen.'));
    }
  });

  return router;
}
