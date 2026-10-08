import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createOAuthRouter, type FetchFn } from '../src/routes/oauth.ts';

function startWith(fetchFn: FetchFn): Promise<{ server: Server; url: string; calls: any[] }> {
  const app = express();
  app.use('/api/oauth', createOAuthRouter({ clientId: 'cid', clientSecret: 'csecret' }, fetchFn));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/api/oauth/callback`, calls: [] });
    });
  });
}

describe('GET /api/oauth/callback', () => {
  it('400s when no authorization code is present', async () => {
    const fetchFn = vi.fn() as unknown as FetchFn;
    const { server, url } = await startWith(fetchFn);
    const res = await fetch(url);
    expect(res.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('exchanges the code and returns a success page on 200', async () => {
    const fetchFn = vi.fn(async (_url: any, init: any) => {
      // assert it posts form-encoded with Basic auth
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toMatch(/^Basic /);
      expect(String(init.body)).toContain('grant_type=authorization_code');
      expect(String(init.body)).toContain('code=abc123');
      return { ok: true, text: async () => '{"access_token":"x"}' };
    }) as unknown as FetchFn;

    const { server, url } = await startWith(fetchFn);
    const res = await fetch(`${url}?code=abc123`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('installeret');
    expect(fetchFn).toHaveBeenCalledOnce();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('502s when the token exchange fails', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 401, text: async () => 'bad' })) as unknown as FetchFn;
    const { server, url } = await startWith(fetchFn);
    const res = await fetch(`${url}?code=abc123`);
    expect(res.status).toBe(502);
    await new Promise<void>((r) => server.close(() => r()));
  });
});
