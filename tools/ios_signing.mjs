#!/usr/bin/env node
// Temporary App Store signing for CI (used by .github/workflows/ios.yml).
// Same tool as hajiheidari/pantomime (tool/ios_signing.mjs); here the bundle
// id comes from IOS_BUNDLE_ID and is registered on first use.
//
//   node tool/ios_signing.mjs prepare <csr-file> <out-dir>
//       creates an Apple Distribution certificate from the CSR and an App Store
//       profile for the app; writes cert.cer + profile.mobileprovision to
//       <out-dir> and prints {"certId","profileId","profileName","profileUuid"}.
//   node tool/ios_signing.mjs cleanup <cert-id> [profile-id]
//       deletes the profile and revokes the certificate (uploaded builds stay
//       valid), so the account never runs out of certificate slots.
//
// Env: ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY (.p8 file, with or without
// its BEGIN/END lines). Never prints secrets.
import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BUNDLE_ID = process.env.IOS_BUNDLE_ID || 'com.espadna.mafia';
const APP_NAME = process.env.IOS_APP_NAME || 'Mafia God';

// Team keys sign with iss = Issuer ID; Individual keys use sub = "user" and no
// iss. The kind that works is remembered after the first successful call.
let keyKind = process.env.ASC_KEY_KIND || 'team';

function token(kind = keyKind) {
  let k = process.env.ASC_PRIVATE_KEY.trim();
  if (!k.includes('BEGIN')) {
    k = `-----BEGIN PRIVATE KEY-----\n${k.replace(/\s+/g, '')}\n-----END PRIVATE KEY-----\n`;
  }
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  // Trimmed: a pasted secret often ends with a space or newline.
  const head = b64u({ alg: 'ES256', kid: process.env.ASC_KEY_ID.trim(), typ: 'JWT' });
  const claims = { iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' };
  if (kind === 'individual') claims.sub = 'user';
  else claims.iss = process.env.ASC_ISSUER_ID.trim();
  const body = b64u(claims);
  const sig = crypto
    .sign('sha256', Buffer.from(`${head}.${body}`), { key: crypto.createPrivateKey(k), dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${head}.${body}.${sig}`;
}

async function api(method, path, body) {
  const send = (kind) =>
    fetch(`https://api.appstoreconnect.apple.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${token(kind)}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  let r = await send(keyKind);
  if (r.status === 401 && keyKind === 'team') {
    // Maybe an Individual key: same key, the other token form.
    const retry = await send('individual');
    if (retry.status !== 401) {
      keyKind = 'individual';
      console.error('using the key as an Individual key');
      r = retry;
    }
  }
  const text = await r.text();
  if (!r.ok) {
    const detail = (() => {
      try {
        return JSON.parse(text).errors.map((e) => `${e.title}: ${e.detail}`).join('; ');
      } catch {
        return text.slice(0, 300);
      }
    })();
    const hint = r.status === 401
      ? ' (Apple rejected the key: the Issuer ID, Key ID and .p8 file must belong to the same Team key with Admin access; an "Individual" key does not work here)'
      : '';
    throw new Error(`${method} ${path} → ${r.status} ${detail}${hint}`);
  }
  return text ? JSON.parse(text) : null;
}

/**
 * Game Center and iCloud (key-value storage) must be on for the App ID
 * before the profile is made, or the profile lacks their entitlements
 * (mobile/ios/App/App/App.entitlements) and the archive is rejected.
 */
async function ensureCapabilities(bundleIdId) {
  const have = await api('GET', `/v1/bundleIds/${bundleIdId}/bundleIdCapabilities`);
  const types = new Set(have.data.map((c) => c.attributes.capabilityType));
  const wanted = [
    { capabilityType: 'GAME_CENTER' },
    { capabilityType: 'ICLOUD', settings: [{ key: 'ICLOUD_VERSION', options: [{ key: 'XCODE_6' }] }] },
  ];
  for (const attributes of wanted) {
    if (types.has(attributes.capabilityType)) continue;
    try {
      await api('POST', '/v1/bundleIdCapabilities', {
        data: {
          type: 'bundleIdCapabilities',
          attributes,
          relationships: { bundleId: { data: { type: 'bundleIds', id: bundleIdId } } },
        },
      });
      console.error(`enabled ${attributes.capabilityType} for ${BUNDLE_ID}`);
    } catch (e) {
      // Already on (409) is fine; anything else shows up when the archive is signed.
      console.error(`capability ${attributes.capabilityType}: ${e.message}`);
    }
  }
}

/**
 * A CI run that dies between creating its certificate and its cleanup step
 * leaves a certificate nobody can use (its private key lived only on that
 * runner), and Apple then refuses new ones. Revokes Distribution
 * certificates made between 10 minutes and 3 days ago: old enough not to
 * belong to a build that is running now, young enough not to be a
 * certificate someone made by hand and keeps using. Returns how many.
 */
async function revokeAbandoned() {
  const year = 365 * 24 * 3600 * 1000;
  const now = Date.now();
  const certs = await api('GET', '/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=50');
  let revoked = 0;
  for (const c of certs.data) {
    const created = new Date(c.attributes.expirationDate).getTime() - year;
    const age = now - created;
    if (age > 10 * 60 * 1000 && age < 3 * 24 * 3600 * 1000) {
      await api('DELETE', `/v1/certificates/${c.id}`);
      console.error(`revoked an abandoned CI certificate (${c.attributes.name}, made ${Math.round(age / 60000)} min ago)`);
      revoked++;
    }
  }
  return revoked;
}

async function prepare(csrFile, outDir) {
  const ids = await api('GET', `/v1/bundleIds?filter[identifier]=${BUNDLE_ID}&limit=20`);
  let bundle = ids.data.find((b) => b.attributes.identifier === BUNDLE_ID);
  if (!bundle) {
    // First build: register the App ID, so the app can then be created in
    // App Store Connect with this bundle id.
    const created = await api('POST', '/v1/bundleIds', {
      data: { type: 'bundleIds', attributes: { identifier: BUNDLE_ID, name: APP_NAME, platform: 'IOS' } },
    });
    bundle = created.data;
    console.error(`registered bundle id ${BUNDLE_ID}`);
  }

  await ensureCapabilities(bundle.id);

  // The certificate comes last, so a failure above never leaves one behind.
  const csr = readFileSync(csrFile, 'utf8').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const create = () => api('POST', '/v1/certificates', {
    data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: csr } },
  });
  let cert;
  try {
    cert = await create();
  } catch (e) {
    if (!/already have a current Distribution certificate/i.test(e.message)) throw e;
    if (!(await revokeAbandoned())) throw e;
    cert = await create();
  }
  writeFileSync(join(outDir, 'cert.cer'), Buffer.from(cert.data.attributes.certificateContent, 'base64'));

  const profileName = `Mafia CI ${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const profile = await api('POST', '/v1/profiles', {
    data: {
      type: 'profiles',
      attributes: { name: profileName, profileType: 'IOS_APP_STORE' },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundle.id } },
        certificates: { data: [{ type: 'certificates', id: cert.data.id }] },
      },
    },
  });
  writeFileSync(
    join(outDir, 'profile.mobileprovision'),
    Buffer.from(profile.data.attributes.profileContent, 'base64'),
  );
  console.log(
    JSON.stringify({
      certId: cert.data.id,
      profileId: profile.data.id,
      profileName,
      profileUuid: profile.data.attributes.uuid,
    }),
  );
}

async function cleanup(certId, profileId) {
  if (profileId) await api('DELETE', `/v1/profiles/${profileId}`).catch((e) => console.error(e.message));
  if (certId) await api('DELETE', `/v1/certificates/${certId}`).catch((e) => console.error(e.message));
  console.log('cleaned up');
}

/** Format check of the three secrets, without printing them (diagnoses a 401). */
function check() {
  const problems = [];
  const issuer = (process.env.ASC_ISSUER_ID || '').trim();
  const keyId = (process.env.ASC_KEY_ID || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issuer)) {
    problems.push(`ASC_ISSUER_ID is not an Issuer ID (expected 36 characters like 69a6de7e-…; got ${issuer.length} characters)`);
  }
  if (!/^[A-Z0-9]{10}$/.test(keyId)) {
    problems.push(`ASC_KEY_ID is not a Key ID (expected 10 capital letters/digits; got ${keyId.length} characters)`);
  }
  if (issuer && keyId && issuer === keyId) problems.push('ASC_ISSUER_ID and ASC_KEY_ID are the same value');
  try {
    let k = (process.env.ASC_PRIVATE_KEY || '').trim();
    if (!k.includes('BEGIN')) k = `-----BEGIN PRIVATE KEY-----\n${k.replace(/\s+/g, '')}\n-----END PRIVATE KEY-----\n`;
    const key = crypto.createPrivateKey(k);
    if (key.asymmetricKeyType !== 'ec') problems.push('ASC_PRIVATE_KEY is not an App Store Connect key (.p8 EC key)');
  } catch {
    problems.push('ASC_PRIVATE_KEY cannot be read: paste the whole AuthKey_….p8 file');
  }
  for (const p of problems) console.error(`::error::${p}`);
  if (problems.length) process.exit(1);
  console.log('secrets look well-formed');
}

export { api };

// Run as a command unless imported (tools/gamecenter_setup.mjs uses api()).
const asCommand = import.meta.url === pathToFileURL(process.argv[1] || '').href;
const [cmd, a, b] = asCommand ? process.argv.slice(2) : [];
if (asCommand) try {
  if (cmd === 'check') check();
  else if (cmd === 'prepare') await prepare(a, b);
  else if (cmd === 'cleanup') await cleanup(a, b);
  else throw new Error('usage: ios_signing.mjs prepare <csr> <dir> | cleanup <certId> [profileId]');
} catch (e) {
  console.error(`::error::${e.message}`);
  process.exit(1);
}
