import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatafordelerProvider, type FetchFn } from '../src/cvr/datafordeler.ts';
import type { DatafordelerLookupBundle } from '../src/cvr/normalizeDatafordeler.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loadFixture = (name: string): DatafordelerLookupBundle =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));

function sequentialFetch(responses: Array<{ ok?: boolean; body: unknown }>): FetchFn {
  let i = 0;
  return vi.fn(async () => {
    const next = responses[i++] ?? { ok: false, body: { errors: [{ message: 'exhausted' }] } };
    return {
      ok: next.ok ?? true,
      text: async () => JSON.stringify(next.body),
    };
  }) as unknown as FetchFn;
}

function virksomhedResponse(bundle: DatafordelerLookupBundle) {
  return {
    data: {
      CVR_Virksomhed: { nodes: [bundle.virksomhed] },
    },
  };
}

function detailsResponse(bundle: DatafordelerLookupBundle) {
  return {
    data: {
      navn: { nodes: bundle.navn },
      adresse: { nodes: bundle.adresse },
      branche: { nodes: bundle.branche },
      form: { nodes: bundle.form },
      reklame: { nodes: bundle.reklame },
      ansatte: { nodes: bundle.ansatte },
      email: { nodes: bundle.email },
      telefon: { nodes: bundle.telefon },
    },
  };
}

const apiKey = 'test-api-key';

describe('DatafordelerProvider', () => {
  it('returns canonical data on a successful two-step lookup', async () => {
    const fixture = loadFixture('datafordeler-example-aps.json');
    const fetchFn = sequentialFetch([
      { body: virksomhedResponse(fixture) },
      { body: detailsResponse(fixture) },
    ]);
    const provider = new DatafordelerProvider({ apiKey, fetchFn, retryDelayMs: 0 });

    const result = await provider.lookup('12345678');
    expect(result.found).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.data?.name).toBe('Eksempel ApS');
    expect(result.data?.email).toBe('kontakt@example.com');
    expect(fetchFn).toHaveBeenCalledTimes(2);

    const firstCall = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(firstCall[0])).toContain(`apiKey=${apiKey}`);
    expect(firstCall[1].method).toBe('POST');
  });

  it('returns a clean miss when Virksomhed has no nodes', async () => {
    const fetchFn = sequentialFetch([
      { body: { data: { CVR_Virksomhed: { nodes: [] } } } },
    ]);
    const provider = new DatafordelerProvider({ apiKey, fetchFn, retryDelayMs: 0 });

    const result = await provider.lookup('00000000');
    expect(result).toEqual({ found: false, data: null, warnings: [] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('treats HTTP failures as transient and retries once', async () => {
    const fetchFn = sequentialFetch([
      { ok: false, body: { error: 'unavailable' } },
      { ok: false, body: { error: 'unavailable' } },
    ]);
    const provider = new DatafordelerProvider({ apiKey, fetchFn, retryDelayMs: 0 });

    const result = await provider.lookup('10150817');
    expect(result).toEqual({ found: false, data: null, warnings: ['quota_exceeded'] });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('recovers on retry when the second virksomhed attempt succeeds', async () => {
    const fixture = loadFixture('datafordeler-10150817.json');
    const fetchFn = sequentialFetch([
      { ok: false, body: { error: 'boom' } },
      { body: virksomhedResponse(fixture) },
      { body: detailsResponse(fixture) },
    ]);
    const provider = new DatafordelerProvider({ apiKey, fetchFn, retryDelayMs: 0 });

    const result = await provider.lookup('10150817');
    expect(result.found).toBe(true);
    expect(result.data?.name).toBe('Erhvervsstyrelsen');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('suppresses phone/email and warns when reklamebeskyttet', async () => {
    const fixture = loadFixture('datafordeler-example-aps.json');
    fixture.reklame = [{ vaerdi: true, virkningFra: '2016-11-04', virkningTil: null }];
    fixture.telefon = [{ vaerdi: '12345678', virkningFra: '2016-11-04', virkningTil: null }];
    const fetchFn = sequentialFetch([
      { body: virksomhedResponse(fixture) },
      { body: detailsResponse(fixture) },
    ]);
    const provider = new DatafordelerProvider({ apiKey, fetchFn, retryDelayMs: 0 });

    const result = await provider.lookup('12345678');
    expect(result.found).toBe(true);
    expect(result.warnings).toContain('reklamebeskyttelse');
    expect(result.data?.phone).toBeNull();
    expect(result.data?.email).toBeNull();
  });

  it('flags ceased companies with an ophoert warning', async () => {
    const fixture = loadFixture('datafordeler-example-aps.json');
    fixture.virksomhed = {
      ...fixture.virksomhed,
      virksomhedOphoersdato: '2020-12-31',
    };
    const fetchFn = sequentialFetch([
      { body: virksomhedResponse(fixture) },
      { body: detailsResponse(fixture) },
    ]);
    const provider = new DatafordelerProvider({ apiKey, fetchFn, retryDelayMs: 0 });

    const result = await provider.lookup('12345678');
    expect(result.found).toBe(true);
    expect(result.data?.status).toBe('ceased');
    expect(result.warnings).toContain('ophoert');
  });

  it('treats a network throw as transient', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as FetchFn;
    const provider = new DatafordelerProvider({ apiKey, fetchFn, retryDelayMs: 0 });

    const result = await provider.lookup('10150817');
    expect(result.warnings).toEqual(['quota_exceeded']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
