// Copies build/tool (made by tools/web_build.mjs) into mobile/www for Capacitor.
// The app ships its files inside the package, so the service worker and the
// mirror/Cloudflare files are left out.
import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const www = join(root, 'mobile/www');
const skip = new Set(['sw.js', 'files.json', '_headers', '_redirects']);
rmSync(www, { recursive: true, force: true });
cpSync(join(root, 'build/tool'), www, {
  recursive: true,
  filter: (src) => !skip.has(src.split('/').pop()),
});
console.log('mobile/www ready');
