import type { CvrProvider, CvrWarning } from '../cvr/provider.ts';
import { PipedriveApiError, type PipedriveClient } from '../pipedrive/client.ts';
import type { ResolvedFieldMap } from '../pipedrive/fields.ts';
import { buildOrganizationUpdate } from '../mapping/fieldMap.ts';
import { FIELD_DEFINITIONS } from '../pipedrive/fieldDefs.ts';

export interface PerformSyncDeps {
  cvrProvider: CvrProvider;
  pipedrive: Pick<PipedriveClient, 'updateOrganization'>;
  fieldMap: ResolvedFieldMap;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

export interface PerformSyncInput {
  organizationId: number;
  cvrnr: string;
  /** Canonical field ids to write; "lastSynced" is always added. */
  fields: string[];
}

export type SyncOutcome =
  | { ok: true; written: string[]; skipped: { id: string; reason: string }[]; warnings: CvrWarning[]; syncedAt: string }
  | { ok: false; reason: 'not_found' | 'quota'; warnings: CvrWarning[] }
  | { ok: false; reason: 'lookup_failed' }
  | { ok: false; reason: 'write_failed'; errors: { message: string; status?: number; detail?: unknown }[]; attempted: string[] };

/** Every toggleable field id (everything except the always-stamped timestamp). */
export const ALL_SYNC_FIELD_IDS = FIELD_DEFINITIONS.map((f) => f.id).filter((id) => id !== 'lastSynced');

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Shared sync core used by both POST /api/sync (manual) and the webhook
 * (automatic): look up CVR, build the opted-in update (always stamping the sync
 * timestamp), and write it in a single all-or-nothing Pipedrive call.
 */
export async function performSync(deps: PerformSyncDeps, input: PerformSyncInput): Promise<SyncOutcome> {
  const now = deps.now ?? (() => new Date());

  let lookup;
  try {
    lookup = await deps.cvrProvider.lookup(input.cvrnr);
  } catch {
    return { ok: false, reason: 'lookup_failed' };
  }

  if (!lookup.found || !lookup.data) {
    if (lookup.warnings.includes('quota_exceeded')) {
      return { ok: false, reason: 'quota', warnings: lookup.warnings };
    }
    return { ok: false, reason: 'not_found', warnings: lookup.warnings };
  }

  const syncedAt = now();
  const selectedFieldIds = Array.from(new Set([...input.fields, 'lastSynced']));
  const { body, written, skipped } = buildOrganizationUpdate(lookup.data, deps.fieldMap, {
    selectedFieldIds,
    syncedAt: toDateOnly(syncedAt),
  });

  try {
    await deps.pipedrive.updateOrganization(input.organizationId, body);
  } catch (err) {
    const errors =
      err instanceof PipedriveApiError
        ? [{ message: err.message, status: err.status, detail: err.body }]
        : [{ message: 'Ukendt fejl ved skrivning til Pipedrive.' }];
    return { ok: false, reason: 'write_failed', errors, attempted: written };
  }

  return { ok: true, written, skipped, warnings: lookup.warnings, syncedAt: syncedAt.toISOString() };
}
