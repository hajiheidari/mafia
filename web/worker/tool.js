// mafia.espadna.com: serves the tool's static files, plus one small API for
// the recovery code (web/tool/backup.js).
//
//   PUT /api/backup/<id>   store an encrypted backup (≤ 700 KB)
//   GET /api/backup/<id>   fetch it back
//
// <id> is SHA-256 of the recovery code; the data is AES-GCM encrypted on
// the phone with a key made from the code, so this server only ever sees
// ciphertext and can neither read a backup nor find one without the code.
// Backups expire 400 days after their last save.

const MAX_BYTES = 700 * 1024;
const TTL_SECONDS = 400 * 24 * 60 * 60;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });

export async function backup(request, env, id) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!/^[0-9a-f]{64}$/.test(id)) return json(400, { error: 'bad id' });
  if (!env.BACKUPS) return json(503, { error: 'backup storage is not configured' });

  if (request.method === 'GET') {
    const data = await env.BACKUPS.get(id);
    return data === null ? json(404, { error: 'not found' }) : json(200, JSON.parse(data));
  }
  if (request.method === 'PUT') {
    const text = await request.text();
    if (text.length > MAX_BYTES) return json(413, { error: 'too large' });
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: 'not json' });
    }
    if (body?.v !== 1 || typeof body.iv !== 'string' || typeof body.data !== 'string') return json(400, { error: 'bad backup' });
    await env.BACKUPS.put(id, JSON.stringify({ v: 1, iv: body.iv, data: body.data, savedAt: Date.now() }), {
      expirationTtl: TTL_SECONDS,
    });
    return json(200, { ok: true });
  }
  return json(405, { error: 'method not allowed' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/backup\/([^/]*)$/);
    if (m) return backup(request, env, m[1]);
    if (url.pathname.startsWith('/api/')) return json(404, { error: 'not found' });
    return env.ASSETS.fetch(request);
  },
};
