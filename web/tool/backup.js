// Recovery code: the group's roles, scenarios and logo, saved under a short
// code (like K7Q2M-9XD4A) so they can be brought back on another phone.
//
// Privacy: the code never leaves the phone. The server (web/worker/tool.js)
// gets SHA-256 of the code as the address and AES-GCM ciphertext made with
// a key derived from the code (PBKDF2), so it can't read or find a backup.

export const API = 'https://mafia.espadna.com/api/backup/';
// Crockford base32: no I, L, O, U, so codes are easy to read aloud.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 10; // 50 bits
const enc = new TextEncoder();

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
}

/** Accepts what people type (spaces, dashes, lower case, O for 0, I/L for 1); null if invalid. */
export function normalizeCode(input) {
  const c = String(input || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return c.length === LENGTH && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}

export const formatCode = (code) => `${code.slice(0, 5)}-${code.slice(5)}`;

const toB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

export async function idFor(code) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`mafia-god-backup:${code}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function keyFor(code) {
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('mafia-god-backup-v1'), iterations: 150000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encrypt(code, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(code), enc.encode(JSON.stringify(value)));
  return { v: 1, iv: toB64(iv), data: toB64(new Uint8Array(data)) };
}

export async function decrypt(code, payload) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(payload.iv) }, await keyFor(code), fromB64(payload.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Saves `value` under the code (replacing an earlier save). */
export async function upload(code, value, fetchFn = fetch) {
  const r = await fetchFn(API + (await idFor(code)), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(await encrypt(code, value)),
  });
  if (!r.ok) throw new Error(`backup failed (${r.status})`);
}

/** The saved value, or null when nothing is saved under this code. */
export async function download(code, fetchFn = fetch) {
  const r = await fetchFn(API + (await idFor(code)));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`restore failed (${r.status})`);
  return decrypt(code, await r.json());
}
