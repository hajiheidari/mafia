#!/usr/bin/env node
// Fills in the App Store listing of the app through the App Store Connect
// API (run by .github/workflows/appstore.yml), and optionally submits the
// version for review:
//
//   - category, content rights, age rating, free price, all territories
//   - name, subtitle and privacy URL per language (store/listing.json;
//     App Store has no Persian, so en-US, ar-SA and ru)
//   - description, keywords, promotional text, support/marketing URLs
//   - screenshots (store/screenshots/{iphone,ipad}/{en,ar,ru}/*.jpg)
//   - the newest processed build of this version, Game Center on the version
//     with the leaderboards and achievements released alongside it
//   - App Review contact and notes (contact details from the workflow inputs)
//   - SUBMIT=true: sends the version to App Review
//
// Safe to run again: it updates what exists and skips screenshots that are
// already there. Things the API cannot do (the App Privacy questionnaire)
// are listed at the end.
//
// Env: ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY, IOS_BUNDLE_ID,
//      VERSION (from mobile/package.json), REVIEW_FIRST_NAME, REVIEW_LAST_NAME,
//      REVIEW_PHONE, REVIEW_EMAIL, SUBMIT.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { api } from './ios_signing.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const BUNDLE_ID = process.env.IOS_BUNDLE_ID || 'com.espadna.mafia';
const VERSION = process.env.VERSION || '1.0.0';
const L = JSON.parse(readFileSync(`${ROOT}store/listing.json`, 'utf8'));
const SITE = 'https://espadna.com/mafia-app/';
const PAGE = { 'en-US': SITE, 'ar-SA': `${SITE}ar/`, ru: `${SITE}ru/` };
const SHOTS = { 'en-US': 'en', 'ar-SA': 'ar', ru: 'ru' };
const DISPLAY = { iphone: 'APP_IPHONE_67', ipad: 'APP_IPAD_PRO_3GEN_129' };

const rel = (type, id) => ({ data: { type, id } });
const log = (...a) => console.log(...a);
let problems = 0;
const warn = (msg) => {
  problems++;
  console.log(`::warning::${msg}`);
};
/** Runs a step; a failure is reported and the next step still runs. */
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    warn(`${name}: ${e.message}`);
  }
}
async function all(path) {
  const out = [];
  let next = path;
  while (next) {
    const page = await api('GET', next.replace('https://api.appstoreconnect.apple.com', ''));
    out.push(...(Array.isArray(page.data) ? page.data : [page.data]));
    next = page.links?.next;
  }
  return out;
}
const one = (path) => api('GET', path).then((r) => r?.data || null).catch((e) => {
  if (/404/.test(e.message)) return null;
  throw e;
});

const apps = await api('GET', `/v1/apps?filter[bundleId]=${BUNDLE_ID}&limit=5`);
const app = apps.data.find((a) => a.attributes.bundleId === BUNDLE_ID);
if (!app) {
  console.error(`::error::no app with bundle id ${BUNDLE_ID}`);
  process.exit(1);
}
log(`app: ${app.attributes.name} (${app.id}), primary locale ${app.attributes.primaryLocale}`);

await step('content rights', () => api('PATCH', `/v1/apps/${app.id}`, {
  data: { type: 'apps', id: app.id, attributes: { contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' } },
}).then(() => log('content rights: no third-party content')));

// ---- app info: categories, names, age rating ----
const infos = await all(`/v1/apps/${app.id}/appInfos`);
const info = infos.find((i) => !/READY_FOR_(SALE|DISTRIBUTION)|REPLACED/.test(i.attributes.appStoreState || i.attributes.state || '')) || infos[0];

await step('categories', async () => {
  const r = {};
  for (const k of ['primaryCategory', 'primarySubcategoryOne', 'primarySubcategoryTwo', 'secondaryCategory']) {
    if (L[k]) r[k] = rel('appCategories', L[k]);
  }
  await api('PATCH', `/v1/appInfos/${info.id}`, { data: { type: 'appInfos', id: info.id, relationships: r } });
  log(`categories: ${L.primaryCategory} (${L.primarySubcategoryOne}, ${L.primarySubcategoryTwo}), ${L.secondaryCategory}`);
});

await step('app info texts', async () => {
  const have = await all(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=50`);
  for (const [locale, t] of Object.entries(L.locales)) {
    const attributes = { name: t.name, subtitle: t.subtitle, privacyPolicyUrl: `${PAGE[locale]}privacy/` };
    const loc = have.find((h) => h.attributes.locale === locale);
    await step(`app info ${locale}`, async () => {
      if (loc) await api('PATCH', `/v1/appInfoLocalizations/${loc.id}`, { data: { type: 'appInfoLocalizations', id: loc.id, attributes } });
      else {
        await api('POST', '/v1/appInfoLocalizations', {
          data: { type: 'appInfoLocalizations', attributes: { locale, ...attributes }, relationships: { appInfo: rel('appInfos', info.id) } },
        });
      }
      log(`name/subtitle ${locale}: ${t.name} — ${t.subtitle}`);
    });
  }
});

await step('age rating', async () => {
  const decl = await one(`/v1/appInfos/${info.id}/ageRatingDeclaration`);
  if (!decl) throw new Error('no age rating declaration found');
  const patch = (attributes) => api('PATCH', `/v1/ageRatingDeclarations/${decl.id}`, { data: { type: 'ageRatingDeclarations', id: decl.id, attributes } });
  // A party game about a fictional mafia: the story mentions night "shots",
  // nothing is shown. Everything else is none.
  await patch({
    alcoholTobaccoOrDrugUseOrReferences: 'NONE', contests: 'NONE', gamblingSimulated: 'NONE',
    horrorOrFearThemes: 'NONE', matureOrSuggestiveThemes: 'NONE', medicalOrTreatmentInformation: 'NONE',
    profanityOrCrudeHumor: 'NONE', sexualContentGraphicAndNudity: 'NONE', sexualContentOrNudity: 'NONE',
    violenceCartoonOrFantasy: 'INFREQUENT_OR_MILD', violenceRealistic: 'NONE',
    violenceRealisticProlongedGraphicOrSadistic: 'NONE', gambling: false, unrestrictedWebAccess: false,
  });
  log('age rating: mild fantasy violence only');
  // Newer questions (2025); each on its own so an unknown one does not block the rest.
  for (const [k, v] of Object.entries({
    lootBox: false, messagingAndChat: false, parentalControls: false, ageAssurance: false,
    userGeneratedContent: false, advertising: false, healthOrWellnessTopics: false, gunsOrOtherWeapons: 'NONE',
  })) {
    await patch({ [k]: v }).catch((e) => log(`  age rating ${k}: ${e.message.split(' → ').pop()}`));
  }
});

// ---- the version ----
const versions = await all(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=20`);
let version = versions.find((v) => /PREPARE_FOR_SUBMISSION|DEVELOPER_REJECTED|REJECTED|METADATA_REJECTED|INVALID_BINARY/.test(v.attributes.appStoreState || v.attributes.appVersionState || ''));
if (!version) {
  version = (await api('POST', '/v1/appStoreVersions', {
    data: { type: 'appStoreVersions', attributes: { platform: 'IOS', versionString: VERSION }, relationships: { app: rel('apps', app.id) } },
  })).data;
  log(`version ${VERSION} created`);
}
log(`version: ${version.attributes.versionString} (${version.attributes.appStoreState || version.attributes.appVersionState})`);

await step('version', () => api('PATCH', `/v1/appStoreVersions/${version.id}`, {
  data: { type: 'appStoreVersions', id: version.id, attributes: { versionString: VERSION, copyright: L.copyright, releaseType: 'AFTER_APPROVAL' } },
}).then(() => log(`version string ${VERSION}, © ${L.copyright}, release after approval`)));

const vlocs = {};
await step('store texts', async () => {
  const have = await all(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`);
  for (const [locale, t] of Object.entries(L.locales)) {
    const attributes = {
      description: t.description, keywords: t.keywords, promotionalText: t.promotionalText,
      supportUrl: PAGE[locale], marketingUrl: PAGE[locale],
    };
    await step(`store texts ${locale}`, async () => {
      let loc = have.find((h) => h.attributes.locale === locale);
      if (loc) await api('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, { data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes } });
      else {
        loc = (await api('POST', '/v1/appStoreVersionLocalizations', {
          data: { type: 'appStoreVersionLocalizations', attributes: { locale, ...attributes }, relationships: { appStoreVersion: rel('appStoreVersions', version.id) } },
        })).data;
      }
      vlocs[locale] = loc.id;
      log(`description, keywords, promo text ${locale}`);
    });
  }
});

// ---- screenshots ----
async function uploadShot(setId, file) {
  const bytes = readFileSync(file);
  const res = await api('POST', '/v1/appScreenshots', {
    data: { type: 'appScreenshots', attributes: { fileName: file.split('/').pop(), fileSize: bytes.length }, relationships: { appScreenshotSet: rel('appScreenshotSets', setId) } },
  });
  for (const op of res.data.attributes.uploadOperations || []) {
    const headers = Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value]));
    const r = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) });
    if (!r.ok) throw new Error(`screenshot upload → ${r.status}`);
  }
  await api('PATCH', `/v1/appScreenshots/${res.data.id}`, {
    data: { type: 'appScreenshots', id: res.data.id, attributes: { uploaded: true, sourceFileChecksum: createHash('md5').update(bytes).digest('hex') } },
  });
}
for (const [locale, locId] of Object.entries(vlocs)) {
  await step(`screenshots ${locale}`, async () => {
    const sets = await all(`/v1/appStoreVersionLocalizations/${locId}/appScreenshotSets?limit=50`);
    for (const [dev, displayType] of Object.entries(DISPLAY)) {
      const dir = `${ROOT}store/screenshots/${dev}/${SHOTS[locale]}`;
      const files = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/.test(f)).sort();
      let set = sets.find((s) => s.attributes.screenshotDisplayType === displayType);
      if (!set) {
        set = (await api('POST', '/v1/appScreenshotSets', {
          data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: displayType }, relationships: { appStoreVersionLocalization: rel('appStoreVersionLocalizations', locId) } },
        })).data;
      }
      const existing = await all(`/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`);
      if (existing.length === files.length) {
        log(`screenshots ${locale} ${dev}: already ${existing.length}`);
        continue;
      }
      for (const s of existing) await api('DELETE', `/v1/appScreenshots/${s.id}`);
      for (const f of files) await uploadShot(set.id, `${dir}/${f}`);
      log(`screenshots ${locale} ${dev}: ${files.length} uploaded`);
    }
  });
}

// ---- build ----
await step('build', async () => {
  const builds = await all(`/v1/builds?filter[app]=${app.id}&filter[preReleaseVersion.version]=${VERSION}&sort=-uploadedDate&limit=10`);
  const build = builds.find((b) => b.attributes.processingState === 'VALID');
  if (!build) throw new Error(`no processed build of ${VERSION} yet (Apple may still be processing it)`);
  await api('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, { data: { type: 'builds', id: build.id } });
  log(`build attached: ${VERSION} (${build.attributes.version}), uploaded ${build.attributes.uploadedDate}`);
});

// ---- price and availability ----
await step('price', async () => {
  if (await one(`/v1/apps/${app.id}/appPriceSchedule`)) {
    log('price: already set');
    return;
  }
  const points = await all(`/v1/apps/${app.id}/appPricePoints?filter[territory]=USA&limit=200`);
  const free = points.find((p) => Number(p.attributes.customerPrice) === 0);
  if (!free) throw new Error('free price point not found');
  await api('POST', '/v1/appPriceSchedules', {
    data: {
      type: 'appPriceSchedules',
      relationships: { app: rel('apps', app.id), baseTerritory: rel('territories', 'USA'), manualPrices: { data: [{ type: 'appPrices', id: '${free}' }] } },
    },
    included: [{ type: 'appPrices', id: '${free}', attributes: { startDate: null }, relationships: { appPricePoint: rel('appPricePoints', free.id) } }],
  });
  log('price: free');
});

await step('availability', async () => {
  if (await one(`/v1/apps/${app.id}/appAvailabilityV2`)) {
    log('availability: already set');
    return;
  }
  const territories = await all('/v1/territories?limit=200');
  await api('POST', '/v2/appAvailabilities', {
    data: {
      type: 'appAvailabilities',
      attributes: { availableInNewTerritories: true },
      relationships: { app: rel('apps', app.id), territoryAvailabilities: { data: territories.map((t) => ({ type: 'territoryAvailabilities', id: `\${${t.id}}` })) } },
    },
    included: territories.map((t) => ({
      type: 'territoryAvailabilities', id: `\${${t.id}}`, attributes: { available: true }, relationships: { territory: rel('territories', t.id) },
    })),
  });
  log(`availability: all ${territories.length} territories`);
});

// ---- Game Center on this version ----
await step('Game Center version', async () => {
  let gcv = await one(`/v1/appStoreVersions/${version.id}/gameCenterAppVersion`);
  if (!gcv) {
    gcv = (await api('POST', '/v1/gameCenterAppVersions', {
      data: { type: 'gameCenterAppVersions', relationships: { appStoreVersion: rel('appStoreVersions', version.id) } },
    })).data;
  }
  log('Game Center: on for this version');
  const detail = await one(`/v1/apps/${app.id}/gameCenterDetail`);
  if (!detail) throw new Error('Game Center is not set up (run the Game Center workflow)');
  const release = (kind, id) => api('POST', `/v1/gameCenter${kind}Releases`, {
    data: { type: `gameCenter${kind}Releases`, relationships: { gameCenterDetail: rel('gameCenterDetails', detail.id), [`gameCenter${kind}`]: rel(`gameCenter${kind}s`, id) } },
  }).catch((e) => { if (!/409/.test(e.message)) throw e; });
  const boards = await all(`/v1/gameCenterDetails/${detail.id}/gameCenterLeaderboards?limit=200`);
  for (const b of boards) await release('Leaderboard', b.id);
  const achs = await all(`/v1/gameCenterDetails/${detail.id}/gameCenterAchievements?limit=200`);
  for (const a of achs) await release('Achievement', a.id);
  log(`Game Center: ${boards.length} leaderboards and ${achs.length} achievements go live with the app`);
});

// ---- App Review ----
const contact = {
  contactFirstName: process.env.REVIEW_FIRST_NAME || undefined,
  contactLastName: process.env.REVIEW_LAST_NAME || undefined,
  contactPhone: process.env.REVIEW_PHONE || undefined,
  contactEmail: process.env.REVIEW_EMAIL || undefined,
};
await step('App Review details', async () => {
  const attributes = { ...contact, demoAccountRequired: false, notes: L.reviewNotes };
  for (const k of Object.keys(attributes)) if (attributes[k] === undefined) delete attributes[k];
  const detail = await one(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`);
  if (detail) await api('PATCH', `/v1/appStoreReviewDetails/${detail.id}`, { data: { type: 'appStoreReviewDetails', id: detail.id, attributes } });
  else {
    await api('POST', '/v1/appStoreReviewDetails', {
      data: { type: 'appStoreReviewDetails', attributes, relationships: { appStoreVersion: rel('appStoreVersions', version.id) } },
    });
  }
  log(`App Review: notes set${contact.contactPhone ? ', contact set' : ' (contact details not given yet)'}`);
});

if (process.env.SUBMIT === 'true') {
  await step('submit for review', async () => {
    if (problems) throw new Error(`not submitted: ${problems} problem(s) above must be fixed first`);
    const sub = (await api('POST', '/v1/reviewSubmissions', {
      data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: rel('apps', app.id) } },
    })).data;
    await api('POST', '/v1/reviewSubmissionItems', {
      data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: rel('reviewSubmissions', sub.id), appStoreVersion: rel('appStoreVersions', version.id) } },
    });
    await api('PATCH', `/v1/reviewSubmissions/${sub.id}`, { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } });
    log('SUBMITTED for App Review');
  });
}

log('\nStill to do by hand in App Store Connect (no API for it): App Privacy → "Data Not Collected" questionnaire.');
log(problems ? `done with ${problems} problem(s); see the warnings above` : 'listing is complete');
if (problems) process.exit(1);
