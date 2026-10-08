import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { SyncDeps } from './sync.ts';
import { performSync, ALL_SYNC_FIELD_IDS } from '../sync/performSync.ts';

export interface WebhookAuth {
  user?: string;
  password?: string;
}

/** Constant-time string compare that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function checkBasicAuth(header: string | undefined, auth: WebhookAuth): boolean {
  // Fail-closed: webhook auth credentials are mandatory. An empty config must
  // never accept anonymous writes into Pipedrive.
  if (!auth.user || !auth.password) return false;
  const m = header?.match(/^Basic\s+(.+)$/i);
  if (!m) return false;
  const [user, pass] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
  return safeEqual(user ?? '', auth.user) && safeEqual(pass ?? '', auth.password);
}

/** Pull a value from a webhook org payload by hash key (top-level or nested custom_fields). */
function readFromPayload(org: unknown, key: string): unknown {
  if (!org || typeof org !== 'object') return undefined;
  const rec = org as Record<string, unknown>;
  if (key in rec) return rec[key];
  const cf = rec.custom_fields;
  if (cf && typeof cf === 'object' && key in (cf as Record<string, unknown>)) {
    return (cf as Record<string, unknown>)[key];
  }
  return undefined;
}

/** Normalize a CVR field value (number or string) to an 8-digit string, else null. */
function normalizeCvrValue(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const s = String(Math.trunc(v));
    return /^\d{8}$/.test(s) ? s : null;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    return /^\d{8}$/.test(s) ? s : null;
  }
  return null;
}

interface ParsedEvent {
  organizationId: number | null;
  currentCvr: string | null;
  previousCvr: string | null;
}

/** Parse both webhook v1 (current/previous, meta.id) and v2 (data/previous, meta.entity_id). */
function parseEvent(body: any, cvrKey: string): ParsedEvent {
  const current = body?.data ?? body?.current ?? null;
  const previous = body?.previous ?? null;
  const meta = body?.meta ?? {};
  const idRaw = meta.entity_id ?? meta.id ?? current?.id ?? null;
  const organizationId =
    idRaw != null && /^\d+$/.test(String(idRaw)) ? Number(idRaw) : null;

  return {
    organizationId,
    currentCvr: normalizeCvrValue(readFromPayload(current, cvrKey)),
    previousCvr: normalizeCvrValue(readFromPayload(previous, cvrKey)),
  };
}

/**
 * POST /  (mounted at /api/webhook)
 *
 * Pipedrive `updated.organization` webhook. Fires a full auto-sync ONLY when the
 * CVR field value actually changed (current != previous). Because our own write
 * re-sends the same CVR value, the follow-up webhook sees no CVR change and is
 * skipped — that is the loop-prevention mechanism.
 */
export function createWebhookRouter(deps: SyncDeps, auth: WebhookAuth): Router {
  const router = Router();
  const cvrKey = deps.fieldMap.get('cvr')?.key;

  router.post('/', async (req, res) => {
    if (!checkBasicAuth(req.header('authorization'), auth)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (!cvrKey) {
      // CVR field not resolved — nothing we can do; ack so Pipedrive stops retrying.
      return res.status(200).json({ skipped: 'cvr_field_unresolved' });
    }

    const { organizationId, currentCvr, previousCvr } = parseEvent(req.body, cvrKey);

    // Only act on a genuine CVR change (covers added + edited; skips our own writes).
    if (organizationId === null || !currentCvr || currentCvr === previousCvr) {
      return res.status(200).json({ skipped: 'no_cvr_change' });
    }

    const outcome = await performSync(deps, {
      organizationId,
      cvrnr: currentCvr,
      fields: ALL_SYNC_FIELD_IDS,
    });

    if (outcome.ok) {
      return res.status(200).json({ ok: true, organizationId, written: outcome.written });
    }
    if (outcome.reason === 'not_found') {
      // A bad CVR number is not retryable — ack to avoid a retry storm.
      return res.status(200).json({ ok: false, reason: 'cvr_not_found' });
    }
    // Transient (quota / lookup / write failure): 502 lets Pipedrive retry.
    return res.status(502).json({ ok: false, reason: outcome.reason });
  });

  return router;
}
