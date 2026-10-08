import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import type { CvrProvider, CvrLookupResult, CvrCompany } from '../src/cvr/provider.ts';
import type { ResolvedFieldMap } from '../src/pipedrive/fields.ts';
import { CUSTOM_FIELD_DEFINITIONS } from '../src/pipedrive/fieldDefs.ts';

const SECRET = 'test-secret';
const COMPANY_ID = 10001;
const WH_USER = 'hook';
const WH_PASS = 'hookpass';
const CVR_KEY = 'key_cvr';

const company: CvrCompany = {
  cvr: '12345678', name: 'Eksempel ApS', address: 'Eksempelvej 1, 2100 København Ø',
  zipcode: '2100', city: 'København Ø', phone: null, email: null, startDate: '2016-11-04',
  industryCode: '620100', industryDesc: 'Computerprogrammering', companyFormCode: '80',
  companyForm: 'Anpartsselskab', employees: '0', protected: false, status: 'active',
};

function makeFieldMap(): ResolvedFieldMap {
  const map: ResolvedFieldMap = new Map();
  for (const def of CUSTOM_FIELD_DEFINITIONS) map.set(def.id, { key: `key_${def.id}`, type: def.type! });
  return map;
}

function stubProvider(result: CvrLookupResult): CvrProvider {
  return { name: 'stub', lookup: vi.fn(async () => result) };
}

let updateSpy: ReturnType<typeof vi.fn>;

async function start(provider?: CvrProvider) {
  updateSpy = vi.fn(async () => ({ id: 1 }));
  const app = createApp({
    sync: {
      jwtSecret: SECRET,
      expectedCompanyId: COMPANY_ID,
      webhookAuth: { user: WH_USER, password: WH_PASS },
      deps: {
        cvrProvider: provider ?? stubProvider({ found: true, data: company, warnings: [] }),
        pipedrive: { updateOrganization: updateSpy, getOrganization: vi.fn() },
        fieldMap: makeFieldMap(),
        now: () => new Date('2026-06-25T10:00:00.000Z'),
      },
    },
  });
  const server: Server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/webhook`;
  return { server, url };
}

function basic(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

function postWebhook(url: string, body: unknown, authHeader?: string) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) },
    body: JSON.stringify(body),
  });
}

describe('POST /api/webhook (auto-sync)', () => {
  let url: string;
  let server: Server;
  beforeEach(async () => {
    ({ server, url } = await start());
    return () => new Promise<void>((r) => server.close(() => r()));
  });

  it('rejects without/with-wrong Basic auth (401)', async () => {
    expect((await postWebhook(url, {})).status).toBe(401);
    expect((await postWebhook(url, {}, basic('hook', 'nope'))).status).toBe(401);
  });

  it('does not mount the webhook when auth credentials are missing', async () => {
    const app = createApp({
      sync: {
        jwtSecret: SECRET,
        expectedCompanyId: COMPANY_ID,
        webhookAuth: {},
        deps: {
          cvrProvider: stubProvider({ found: true, data: company, warnings: [] }),
          pipedrive: { updateOrganization: vi.fn(), getOrganization: vi.fn() },
          fieldMap: makeFieldMap(),
        },
      },
    });
    const bare: Server = await new Promise((r) => {
      const s = app.listen(0, () => r(s));
    });
    const bareUrl = `http://127.0.0.1:${(bare.address() as AddressInfo).port}/api/webhook`;
    try {
      const res = await postWebhook(bareUrl, {}, basic('hook', 'hookpass'));
      // Express returns 404 when the route is not mounted.
      expect(res.status).toBe(404);
    } finally {
      await new Promise<void>((r) => bare.close(() => r()));
    }
  });

  it('syncs when the CVR field is newly added (v1 payload)', async () => {
    const body = {
      meta: { action: 'updated', object: 'organization', id: 42 },
      previous: { [CVR_KEY]: null },
      current: { [CVR_KEY]: 12345678 },
    };
    const res = await postWebhook(url, body, basic(WH_USER, WH_PASS));
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledOnce();
    expect(updateSpy.mock.calls[0][0]).toBe(42); // org id
  });

  it('syncs when the CVR field changes (v2 payload, nested custom_fields)', async () => {
    const body = {
      meta: { action: 'change', entity: 'organization', entity_id: '77', version: '2.0' },
      previous: { custom_fields: { [CVR_KEY]: 10150817 } },
      data: { custom_fields: { [CVR_KEY]: 12345678 } },
    };
    const res = await postWebhook(url, body, basic(WH_USER, WH_PASS));
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledOnce();
    expect(updateSpy.mock.calls[0][0]).toBe(77);
  });

  it('does NOT sync when CVR is unchanged (loop prevention)', async () => {
    const body = {
      meta: { action: 'updated', object: 'organization', id: 42 },
      previous: { [CVR_KEY]: 12345678 },
      current: { [CVR_KEY]: 12345678 },
    };
    const res = await postWebhook(url, body, basic(WH_USER, WH_PASS));
    expect(res.status).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does NOT sync when no CVR is present', async () => {
    const body = {
      meta: { action: 'updated', object: 'organization', id: 42 },
      previous: { name: 'Old' },
      current: { name: 'New' },
    };
    const res = await postWebhook(url, body, basic(WH_USER, WH_PASS));
    expect(res.status).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('acks (200) a not-found CVR without retry, and does not write', async () => {
    server.close();
    ({ server, url } = await start(stubProvider({ found: false, data: null, warnings: [] })));
    const body = {
      meta: { id: 42 },
      previous: { [CVR_KEY]: null },
      current: { [CVR_KEY]: 12345678 },
    };
    const res = await postWebhook(url, body, basic(WH_USER, WH_PASS));
    expect(res.status).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('returns 502 (retryable) on a transient quota error', async () => {
    server.close();
    ({ server, url } = await start(stubProvider({ found: false, data: null, warnings: ['quota_exceeded'] })));
    const body = { meta: { id: 42 }, previous: { [CVR_KEY]: null }, current: { [CVR_KEY]: 12345678 } };
    const res = await postWebhook(url, body, basic(WH_USER, WH_PASS));
    expect(res.status).toBe(502);
  });
});
