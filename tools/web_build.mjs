#!/usr/bin/env node
// Builds the two static sites of the Mafia narrator tool:
//
//   build/tool/      → https://mafia.espadna.com       (the tool itself)
//   build/landing/   → https://espadna.com/mafia-app/  (landing pages, en/fa/ar)
//   build/mafia-web.zip  build/tool for a manual mirror (any folder of any host)
//
// Each site gets _headers (Cloudflare cache rules) and files.json: every file
// with its sha256 plus the _redirects text, which the Iranian mirror
// (hajiheidari/espadna-site, mirror-ir/sync.php) copies to espadna.ir.
//
//   node tools/web_build.mjs
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const build = join(root, 'build');

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const rel = (base, f) => relative(base, f).split('\\').join('/');
const sha = (data) => createHash('sha256').update(data).digest('hex');

/** files.json for the mirror; `dir` is the folder that maps to the site's root URL. */
function manifest(dir, redirects) {
  const files = walk(dir)
    .map((f) => rel(dir, f))
    .filter((f) => !['files.json', '_headers', '_redirects'].includes(f))
    .sort()
    .map((f) => {
      const data = readFileSync(join(dir, f));
      return { path: f, size: data.length, sha256: sha(data) };
    });
  const version = sha(files.map((f) => f.sha256).join('') + redirects).slice(0, 12);
  writeFileSync(join(dir, 'files.json'), JSON.stringify({ version, files, redirects }));
  return { version, count: files.length };
}

// --- the tool -------------------------------------------------------------
const tool = join(build, 'tool');
rmSync(tool, { recursive: true, force: true });
cpSync(join(root, 'web/tool'), tool, { recursive: true });

// Service worker cache name changes with the content, so a new release
// replaces the old offline copy.
const appFiles = walk(tool).map((f) => rel(tool, f)).filter((f) => f !== 'sw.js').sort();
const toolVersion = sha(appFiles.map((f) => f + sha(readFileSync(join(tool, f)))).join('')).slice(0, 12);
const swPath = join(tool, 'sw.js');
writeFileSync(swPath, readFileSync(swPath, 'utf8').replace('__VERSION__', toolVersion));

writeFileSync(join(tool, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
/sw.js
  Cache-Control: no-cache
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/*.js
  Cache-Control: no-cache
/*.css
  Cache-Control: no-cache
/fonts/*
  Cache-Control: public, max-age=31536000, immutable
`);
const toolRedirects = '';
writeFileSync(join(tool, '_redirects'), toolRedirects);
const t = manifest(tool, toolRedirects);

// --- landing pages ---------------------------------------------------------
const landing = join(build, 'landing');
rmSync(landing, { recursive: true, force: true });
cpSync(join(root, 'web/landing'), landing, { recursive: true });
const landingSite = join(landing, 'mafia-app');
writeFileSync(join(landing, '_headers'), `/mafia-app/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
/mafia-app/fonts/*
  Cache-Control: public, max-age=31536000, immutable
`);
// Paths in files.json and in the redirects are relative to /mafia-app/.
const landingRedirects = '/en /mafia-app/ 301\n/en/ /mafia-app/ 301\n';
writeFileSync(join(landing, '_redirects'), '/mafia-app/en /mafia-app/ 301\n/mafia-app/en/ /mafia-app/ 301\n');
const l = manifest(landingSite, landingRedirects);

// --- zip of the tool for a manual mirror -----------------------------------
const zip = join(build, 'mafia-web.zip');
rmSync(zip, { force: true });
if (existsSync('/usr/bin/zip')) {
  execFileSync('zip', ['-qr', zip, '.', '-x', '_headers', '_redirects'], { cwd: tool });
}

console.log(`build/tool: ${t.count} files, version ${t.version} (sw ${toolVersion})`);
console.log(`build/landing/mafia-app: ${l.count} files, version ${l.version}`);
