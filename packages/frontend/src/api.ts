import type { CvrLookupResult, OrgInfo, SyncResponse } from './types.ts';
import { getSignedToken } from './sdk.ts';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, withAuth = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (withAuth) {
    const token = await getSignedToken();
    if (!token) {
      throw new ApiError('Ikke tilgængelig uden for Pipedrive.', 401, 'no_token');
    }
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(body?.message ?? `Fejl (${res.status})`, res.status, body?.error);
  }
  return body as T;
}

/** Public CVR lookup (no auth required). */
export function lookupCvr(cvrnr: string): Promise<CvrLookupResult> {
  return request<CvrLookupResult>(`/api/cvr/${cvrnr}`);
}

/** Read the org's existing CVR + last-synced (auth required). */
export function getOrgInfo(orgId: number): Promise<OrgInfo> {
  return request<OrgInfo>(`/api/org/${orgId}`, {}, true);
}

/** Write the selected fields to the org (auth required). */
export function syncOrg(
  organizationId: number,
  cvrnr: string,
  fields: string[],
): Promise<SyncResponse> {
  return request<SyncResponse>(
    '/api/sync',
    { method: 'POST', body: JSON.stringify({ organizationId, cvrnr, fields }) },
    true,
  );
}
