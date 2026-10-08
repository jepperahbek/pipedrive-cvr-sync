import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.ts';
import type { ResolvedFieldMap } from '../src/pipedrive/fields.ts';
import { CUSTOM_FIELD_DEFINITIONS } from '../src/pipedrive/fieldDefs.ts';

const SECRET = 'test-secret';
const COMPANY_ID = 10001;

function makeFieldMap(): ResolvedFieldMap {
  const map: ResolvedFieldMap = new Map();
  for (const def of CUSTOM_FIELD_DEFINITIONS) {
    map.set(def.id, { key: `key_${def.id}`, type: def.type! });
  }
  return map;
}

function token(): string {
  return jwt.sign({ userId: 1, companyId: COMPANY_ID }, SECRET, { algorithm: 'HS256', expiresIn: '5m' });
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const fieldMap = makeFieldMap();
  const cvrKey = fieldMap.get('cvr')!.key;
  const lastKey = fieldMap.get('lastSynced')!.key;

  const getOrganization = vi.fn(async (id: number) => ({
    id,
    name: 'Erhvervsstyrelsen',
    [cvrKey]: 10150817, // stored as a double
    [lastKey]: '2026-06-20',
  }));

  const app = createApp({
    sync: {
      jwtSecret: SECRET,
      expectedCompanyId: COMPANY_ID,
      deps: {
        cvrProvider: { name: 'stub', lookup: vi.fn() },
        pipedrive: { updateOrganization: vi.fn(), getOrganization },
        fieldMap,
      },
    },
  });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('GET /api/org/:id', () => {
  it('requires a JWT (401 without)', async () => {
    const res = await fetch(`${baseUrl}/api/org/1`);
    expect(res.status).toBe(401);
  });

  it('returns the existing CVR (coerced from double) and last-synced date', async () => {
    const res = await fetch(`${baseUrl}/api/org/55`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json).toEqual({
      id: 55,
      name: 'Erhvervsstyrelsen',
      cvr: '10150817',
      lastSynced: '2026-06-20',
    });
  });
});
