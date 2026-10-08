import { Router } from 'express';
import { z } from 'zod';
import { PipedriveApiError, type PipedriveClient } from '../pipedrive/client.ts';
import type { ResolvedFieldMap } from '../pipedrive/fields.ts';

export interface OrgDeps {
  pipedrive: Pick<PipedriveClient, 'getOrganization'>;
  fieldMap: ResolvedFieldMap;
}

const idSchema = z.object({ id: z.coerce.number().int().positive() });

/** Read a custom-field value off a raw org record by canonical field id. */
function readField(org: Record<string, unknown>, fieldMap: ResolvedFieldMap, id: string): unknown {
  const key = fieldMap.get(id)?.key;
  return key ? org[key] : undefined;
}

/**
 * GET / (mounted at /api/org, behind the JWT middleware)
 *
 * Returns the org's current name + existing CVR number + last-synced date so the
 * panel can decide whether to auto-lookup ("already has a CVR") or show the
 * input form.
 */
export function createOrgRouter(deps: OrgDeps): Router {
  const router = Router();

  router.get('/:id', async (req, res) => {
    const parsed = idSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request', message: 'Ugyldigt organisations-id' });
    }

    let org: Record<string, unknown>;
    try {
      org = await deps.pipedrive.getOrganization(parsed.data.id);
    } catch (err) {
      const status = err instanceof PipedriveApiError && err.status === 404 ? 404 : 502;
      return res.status(status).json({
        error: status === 404 ? 'org_not_found' : 'pipedrive_read_failed',
        message:
          status === 404
            ? 'Organisationen blev ikke fundet.'
            : 'Kunne ikke hente organisationen fra Pipedrive.',
      });
    }

    const rawCvr = readField(org, deps.fieldMap, 'cvr');
    let cvr: string | null = null;
    if (typeof rawCvr === 'number' && Number.isFinite(rawCvr)) {
      cvr = String(Math.trunc(rawCvr));
    } else if (typeof rawCvr === 'string' && /^\d+$/.test(rawCvr.trim())) {
      cvr = rawCvr.trim();
    }

    const lastSyncedRaw = readField(org, deps.fieldMap, 'lastSynced');
    const lastSynced = typeof lastSyncedRaw === 'string' && lastSyncedRaw ? lastSyncedRaw : null;

    return res.json({
      id: parsed.data.id,
      name: typeof org.name === 'string' ? org.name : null,
      cvr,
      lastSynced,
    });
  });

  return router;
}
