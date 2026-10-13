import { describe, test, expect } from 'vitest';
// @ts-expect-error plain JS module shipped as-is to the static host
import * as B from '../../web/tool/backup.js';
// @ts-expect-error plain JS module deployed as a Cloudflare Worker
import worker from '../../web/worker/tool.js';

/** The Worker with an in-memory KV, called through a fetch-like function. */
function fakeServer() {
  const kv = new Map<string, string>();
  const env = {
    BACKUPS: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) },
    ASSETS: { fetch: async () => new Response('asset') },
  };
  const fetchFn = (url: string, init?: RequestInit) => worker.fetch(new Request(url, init), env);
  return { kv, fetchFn };
}

describe('recovery code', () => {
  test('codes are 10 easy characters and survive how people type them', () => {
    const code = B.newCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(B.normalizeCode(` ${B.formatCode(code).toLowerCase()} `)).toBe(code);
    expect(B.normalizeCode('k7q2m-9xdoa')).toBe('K7Q2M9XD0A');
    expect(B.normalizeCode('too-short')).toBeNull();
  });

  test('round trip through the Worker; the server only sees ciphertext', async () => {
    const { kv, fetchFn } = fakeServer();
    const code = B.newCode();
    const library = { brand: { name: 'مافیای الون', logo: 'data:image/png;base64,AAAA' }, roles: [{ id: 'c_1', name: 'بازپرس' }], scenarios: [] };
    await B.upload(code, { library }, fetchFn);
    const stored = [...kv.values()][0]!;
    expect(stored).not.toContain('الون');
    expect(stored).not.toContain(code);
    expect(await B.download(code, fetchFn)).toEqual({ library });
    expect(await B.download(B.newCode(), fetchFn)).toBeNull();
  });

  test('a wrong code cannot decrypt someone else’s backup', async () => {
    const payload = await B.encrypt('AAAAAAAAAA', { x: 1 });
    await expect(B.decrypt('AAAAAAAAAB', payload)).rejects.toThrow();
  });

  test('the Worker rejects bad ids, junk and oversize bodies, and serves other paths as files', async () => {
    const { fetchFn } = fakeServer();
    expect((await fetchFn('https://mafia.espadna.com/api/backup/xyz')).status).toBe(400);
    const id = 'a'.repeat(64);
    expect((await fetchFn(`https://mafia.espadna.com/api/backup/${id}`, { method: 'PUT', body: '{"v":2}' })).status).toBe(400);
    expect((await fetchFn(`https://mafia.espadna.com/api/backup/${id}`, { method: 'PUT', body: 'x'.repeat(800 * 1024) })).status).toBe(413);
    expect((await fetchFn(`https://mafia.espadna.com/api/backup/${id}`, { method: 'OPTIONS' })).headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await (await fetchFn('https://mafia.espadna.com/')).text()).toBe('asset');
  });
});
