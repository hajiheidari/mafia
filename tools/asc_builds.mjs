#!/usr/bin/env node
// Prints the app's recent builds and uploads with Apple's processing state
// and any errors/warnings (e.g. why a build became "Invalid Binary").
// Env: ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY, IOS_BUNDLE_ID.
import { api } from './ios_signing.mjs';

const BUNDLE_ID = process.env.IOS_BUNDLE_ID || 'com.espadna.mafia';
const show = (label, x) => console.log(`${label}: ${JSON.stringify(x, null, 2)}`);

const apps = await api('GET', `/v1/apps?filter[bundleId]=${BUNDLE_ID}&limit=5`);
const app = apps.data.find((a) => a.attributes.bundleId === BUNDLE_ID);
const builds = await api('GET', `/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=5`);
for (const b of builds.data) {
  const a = b.attributes;
  console.log(`build ${a.version} uploaded ${a.uploadedDate}: processingState=${a.processingState} expired=${a.expired}`);
}
for (const path of [
  `/v1/buildUploads?filter[app]=${app.id}&limit=5`,
  `/v1/apps/${app.id}/buildUploads?limit=5`,
  `/v1/apps/${app.id}/appStoreVersions?limit=3`,
]) {
  try {
    show(path, (await api('GET', path)).data.map((d) => d.attributes));
  } catch (e) {
    console.log(`${path} → ${e.message}`);
  }
}
