import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { createApp, type SyncConfig } from '../src/app.ts';
import type { CvrProvider, CvrLookupResult, CvrCompany } from '../src/cvr/provider.ts';
import type { ResolvedFieldMap } from '../src/pipedrive/fields.ts';
import { CUSTOM_FIELD_DEFINITIONS } from '../src/pipedrive/fieldDefs.ts';
import { PipedriveApiError } from '../src/pipedrive/client.ts';

const SECRET = 'test-secret';
const COMPANY_ID = 10001;

const company: CvrCompany = {
  cvr: '12345678',
  name: 'Eksempel ApS',
  address: 'Eksempelvej 1, 2100 København Ø',
  zipcode: '2100',
  city: 'København Ø',
  phone: null,
  email: 'kontakt@example.com',
  startDate: '2016-11-04',
  industryCode: '620100',
  industryDesc: 'Computerprogrammering',
  companyFormCode: '80',
  companyForm: 'Anpartsselskab',
  employees: '0',
  protected: false,
  status: 'active',
};

function makeFieldMap(): ResolvedFieldMap {
  const map: ResolvedFieldMap = new Map();
  for (const def of CUSTOM_FIELD_DEFINITIONS) {
    map.set(def.id, { key: `key_${def.id}`, type: def.type! });
  }
  return map;
}

function stubProvider(result: CvrLookupResult): CvrProvider {
  return { name: 'stub', lookup: vi.fn(async () => result) };
}

function signToken(payload: object, opts: jwt.SignOptions = { expiresIn: '5m' }): string {
  return jwt.sign(payload, SECRET, { algorithm: 'HS256', ...opts });
}

interface Harness {
  server: Server;
  baseUrl: string;
  updateSpy: ReturnType<typeof vi.fn>;
}

async function startApp(overrides: Partial<SyncConfig['deps']> = {}, updateImpl?: (...a: any[]) => any): Promise<Harness> {
  const updateSpy = vi.fn(updateImpl ?? (async () => ({ id: 1 })));
  const config: SyncConfig = {
    jwtSecret: SECRET,
    expectedCompanyId: COMPANY_ID,
    deps: {
      cvrProvider: overrides.cvrProvider ?? stubProvider({ found: true, data: company, warnings: [] }),
      pipedrive: { updateOrganization: updateSpy, getOrganization: vi.fn(async () => ({ id: 1 })) },
      fieldMap: overrides.fieldMap ?? makeFieldMap(),
      now: () => new Date('2026-06-25T10:00:00.000Z'),
    },
  };
  const app = createApp({ sync: config });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}`, updateSpy };
}

function post(baseUrl: string, body: unknown, token?: string) {
  return fetch(`${baseUrl}/api/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const validBody = { organizationId: 1, cvrnr: '12345678', fields: ['cvr', 'companyForm'] };

describe('POST /api/sync — JWT verification', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startApp();
  });
  afterAll(async () => {
    await new Promise<void>((r) => h.server.close(() => r()));
  });

  it('rejects a missing token with 401', async () => {
    const res = await post(h.baseUrl, validBody);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token with 401', async () => {
    const token = signToken({ userId: 1, companyId: COMPANY_ID }, { expiresIn: -10 });
    const res = await post(h.baseUrl, validBody, token);
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret with 401', async () => {
    const token = jwt.sign({ userId: 1, companyId: COMPANY_ID }, 'wrong-secret', { algorithm: 'HS256' });
    const res = await post(h.baseUrl, validBody, token);
    expect(res.status).toBe(401);
  });

  it('rejects a token from a different company with 403', async () => {
    const token = signToken({ userId: 1, companyId: 99999999 });
    const res = await post(h.baseUrl, validBody, token);
    expect(res.status).toBe(403);
  });

  it('rejects a token missing companyId when a company guard is configured', async () => {
    const token = signToken({ userId: 1 });
    const res = await post(h.baseUrl, validBody, token);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/sync — behavior', () => {
  it('writes only opted-in fields (plus the forced sync timestamp) and returns ok', async () => {
    const h = await startApp();
    const token = signToken({ userId: 1, companyId: COMPANY_ID });
    const res = await post(h.baseUrl, { organizationId: 42, cvrnr: '12345678', fields: ['cvr', 'companyForm'] }, token);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.written).toEqual(expect.arrayContaining(['cvr', 'companyForm', 'lastSynced']));
    // not opted-in, must not be written
    expect(json.written).not.toContain('employees');
    expect(json.syncedAt).toBe('2026-06-25T10:00:00.000Z');

    // the actual Pipedrive payload only carries the opted-in + timestamp keys
    const [orgId, body] = h.updateSpy.mock.calls[0];
    expect(orgId).toBe(42);
    expect(body).toHaveProperty('key_cvr', 12345678);
    expect(body).toHaveProperty('key_companyForm', 'Anpartsselskab');
    expect(body).toHaveProperty('key_lastSynced', '2026-06-25');
    expect(body).not.toHaveProperty('key_employees');
    await new Promise<void>((r) => h.server.close(() => r()));
  });

  it('still syncs a ceased company but flags it via warnings', async () => {
    const ceased: CvrCompany = { ...company, status: 'ceased' };
    const h = await startApp({
      cvrProvider: stubProvider({ found: true, data: ceased, warnings: ['ophoert'] }),
    });
    const token = signToken({ userId: 1, companyId: COMPANY_ID });
    const res = await post(h.baseUrl, validBody, token);

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.warnings).toContain('ophoert');
    expect(h.updateSpy).toHaveBeenCalledOnce();
    await new Promise<void>((r) => h.server.close(() => r()));
  });

  it('returns 404 when the CVR number is not found', async () => {
    const h = await startApp({ cvrProvider: stubProvider({ found: false, data: null, warnings: [] }) });
    const token = signToken({ userId: 1, companyId: COMPANY_ID });
    const res = await post(h.baseUrl, validBody, token);
    expect(res.status).toBe(404);
    expect(h.updateSpy).not.toHaveBeenCalled();
    await new Promise<void>((r) => h.server.close(() => r()));
  });

  it('returns 503 when CVR is quota-limited', async () => {
    const h = await startApp({
      cvrProvider: stubProvider({ found: false, data: null, warnings: ['quota_exceeded'] }),
    });
    const token = signToken({ userId: 1, companyId: COMPANY_ID });
    const res = await post(h.baseUrl, validBody, token);
    expect(res.status).toBe(503);
    await new Promise<void>((r) => h.server.close(() => r()));
  });

  it('returns 502 with structured errors and reports no success when the write fails', async () => {
    const h = await startApp({}, async () => {
      throw new PipedriveApiError('Field validation failed', 400, { error: 'bad field' });
    });
    const token = signToken({ userId: 1, companyId: COMPANY_ID });
    const res = await post(h.baseUrl, validBody, token);

    expect(res.status).toBe(502);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(false);
    expect(json.error).toBe('pipedrive_write_failed');
    expect(json.errors[0].message).toBe('Field validation failed');
    await new Promise<void>((r) => h.server.close(() => r()));
  });

  it('rejects a non-8-digit cvrnr with 400', async () => {
    const h = await startApp();
    const token = signToken({ userId: 1, companyId: COMPANY_ID });
    const res = await post(h.baseUrl, { organizationId: 1, cvrnr: '123', fields: [] }, token);
    expect(res.status).toBe(400);
    await new Promise<void>((r) => h.server.close(() => r()));
  });
});
