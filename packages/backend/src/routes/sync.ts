import { Router } from 'express';
import { z } from 'zod';
import type { PipedriveClient } from '../pipedrive/client.ts';
import { performSync, type PerformSyncDeps } from '../sync/performSync.ts';

/** Shared deps for the authenticated routes (sync + org read + webhook). */
export interface SyncDeps extends Omit<PerformSyncDeps, 'pipedrive'> {
  pipedrive: Pick<PipedriveClient, 'updateOrganization' | 'getOrganization'>;
}

const syncBodySchema = z.object({
  organizationId: z.number().int().positive(),
  cvrnr: z.string().regex(/^\d{8}$/, 'CVR-nummer skal være præcis 8 cifre'),
  fields: z.array(z.string()).default([]),
});

/**
 * POST /  (mounted at /api/sync, behind the JWT middleware)
 *
 * Thin HTTP wrapper over performSync. Never reports partial success: a write
 * failure returns 502 with structured errors and writes nothing.
 */
export function createSyncRouter(deps: SyncDeps): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const parsed = syncBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid_request',
        message: parsed.error.issues[0]?.message ?? 'Ugyldig forespørgsel',
      });
    }
    const { organizationId, cvrnr, fields } = parsed.data;
    const outcome = await performSync(deps, { organizationId, cvrnr, fields });

    if (outcome.ok) {
      return res.json({
        ok: true,
        written: outcome.written,
        skipped: outcome.skipped,
        warnings: outcome.warnings,
        syncedAt: outcome.syncedAt,
      });
    }

    switch (outcome.reason) {
      case 'quota':
        return res.status(503).json({
          error: 'quota_exceeded',
          message: 'CVR-tjenesten er midlertidigt begrænset — prøv igen om lidt.',
          warnings: outcome.warnings,
        });
      case 'not_found':
        return res.status(404).json({
          error: 'cvr_not_found',
          message: 'CVR-nummer ikke fundet. Tjek nummeret eller søg på virk.dk.',
          warnings: outcome.warnings,
        });
      case 'lookup_failed':
        return res.status(502).json({
          error: 'cvr_lookup_failed',
          message: 'Kunne ikke hente CVR-data lige nu. Prøv igen om lidt.',
        });
      case 'write_failed':
        return res.status(502).json({
          ok: false,
          error: 'pipedrive_write_failed',
          message: 'Kunne ikke gemme data i Pipedrive. Ingen felter blev opdateret.',
          errors: outcome.errors,
          attempted: outcome.attempted,
        });
    }
  });

  return router;
}
