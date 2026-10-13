#!/usr/bin/env node
// Prints the id of a Workers KV namespace, creating it on first use.
//
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node tools/cf_kv.mjs mafia-backups
//
// Used by .github/workflows/web.yml before deploying mafia.espadna.com, so
// nobody has to create the namespace by hand. The token needs the
// "Workers KV Storage: Edit" permission.
const title = process.argv[2];
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
if (!title || !token || !account) {
  console.error('usage: CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node tools/cf_kv.mjs <title>');
  process.exit(2);
}
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces`;
async function cf(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) {
    throw new Error(`${method} ${url} → ${r.status} ${(j.errors || []).map((e) => e.message).join('; ')}`);
  }
  return j;
}
for (let page = 1; ; page++) {
  const j = await cf('GET', `${base}?per_page=100&page=${page}`);
  const found = j.result.find((n) => n.title === title);
  if (found) {
    console.log(found.id);
    process.exit(0);
  }
  if (j.result.length < 100) break;
}
const created = await cf('POST', base, { title });
console.error(`created KV namespace ${title}`);
console.log(created.result.id);
