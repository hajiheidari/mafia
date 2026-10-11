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

const BUNDLE_ID = process.env.IOS_BUNDLE_ID || 'com.espadna.mafia';
const APP_NAME = process.env.IOS_APP_NAME || 'Mafia Narrator';

function token() {
  let k = process.env.ASC_PRIVATE_KEY.trim();
  if (!k.includes('BEGIN')) {
    k = `-----BEGIN PRIVATE KEY-----\n${k.replace(/\s+/g, '')}\n-----END PRIVATE KEY-----\n`;
  }
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64u({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' });
  const body = b64u({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' });
  const sig = crypto
    .sign('sha256', Buffer.from(`${head}.${body}`), { key: crypto.createPrivateKey(k), dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${head}.${body}.${sig}`;
}

async function api(method, path, body) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) {
    const detail = (() => {
      try {
        return JSON.parse(text).errors.map((e) => `${e.title}: ${e.detail}`).join('; ');
      } catch {
        return text.slice(0, 300);
      }
    })();
    throw new Error(`${method} ${path} → ${r.status} ${detail}`);
  }
  return text ? JSON.parse(text) : null;
}

async function prepare(csrFile, outDir) {
  const csr = readFileSync(csrFile, 'utf8').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const cert = await api('POST', '/v1/certificates', {
    data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: csr } },
  });
  writeFileSync(join(outDir, 'cert.cer'), Buffer.from(cert.data.attributes.certificateContent, 'base64'));

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

const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === 'prepare') await prepare(a, b);
  else if (cmd === 'cleanup') await cleanup(a, b);
  else throw new Error('usage: ios_signing.mjs prepare <csr> <dir> | cleanup <certId> [profileId]');
} catch (e) {
  console.error(`::error::${e.message}`);
  process.exit(1);
}
