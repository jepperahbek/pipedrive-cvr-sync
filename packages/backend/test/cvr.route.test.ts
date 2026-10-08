import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/cvr/:cvrnr validation', () => {
  it('returns 400 for fewer than 8 digits', async () => {
    const res = await fetch(`${baseUrl}/api/cvr/1234567`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_cvr');
  });

  it('returns 400 for non-numeric input', async () => {
    const res = await fetch(`${baseUrl}/api/cvr/abcdefgh`);
    expect(res.status).toBe(400);
  });

  it('returns 400 for more than 8 digits', async () => {
    const res = await fetch(`${baseUrl}/api/cvr/123456789`);
    expect(res.status).toBe(400);
  });
});

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
