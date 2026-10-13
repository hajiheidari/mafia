#!/usr/bin/env node
// Sets up Game Center for the app in App Store Connect, through the API key
// the iOS build already uses (run by .github/workflows/gamecenter.yml):
//
//   - Game Center turned on for the app
//   - two recurring leaderboards (web/tool/stats.js LEADERBOARDS): games
//     hosted this week and this month
//   - one achievement per medal (web/tool/stats.js MEDALS), with names and
//     descriptions from web/tool/lang/{en,ar,ru}.js and the images in
//     mobile/gamecenter/medals/<key>.png
//
// Safe to run again: whatever already exists is left as it is. App Store
// Connect has no Persian locale, so Persian players see the English names
// in Apple's Game Center screens (the app's own medal list is in Persian).
//
// Env: ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY, IOS_BUNDLE_ID (default com.espadna.mafia).
import { readFileSync, statSync } from 'node:fs';
import { api } from './ios_signing.mjs';
import { LEADERBOARDS, MEDALS } from '../web/tool/stats.js';
import en from '../web/tool/lang/en.js';
import ar from '../web/tool/lang/ar.js';
import ru from '../web/tool/lang/ru.js';

const BUNDLE_ID = process.env.IOS_BUNDLE_ID || 'com.espadna.mafia';
const ROOT = new URL('..', import.meta.url).pathname;
// App Store Connect locale → the app's language table.
const LOCALES = { 'en-US': en, 'ar-SA': ar, ru };

const plain = (s) => String(s).replace(/<[^>]+>/g, '');
const log = (...a) => console.log(...a);
let problems = 0;
const warn = (msg) => {
  problems++;
  console.log(`::warning::${msg}`);
};

async function all(path) {
  const out = [];
  let next = path;
  while (next) {
    const page = await api('GET', next.replace('https://api.appstoreconnect.apple.com', ''));
    out.push(...page.data);
    next = page.links?.next;
  }
  return out;
}

const rel = (type, id) => ({ data: { type, id } });

async function gameCenterDetail(appId) {
  try {
    const r = await api('GET', `/v1/apps/${appId}/gameCenterDetail`);
    if (r?.data) return r.data.id;
  } catch (e) {
    if (!/404/.test(e.message)) throw e;
  }
  const r = await api('POST', '/v1/gameCenterDetails', {
    data: { type: 'gameCenterDetails', relationships: { app: rel('apps', appId) } },
  });
  log('Game Center turned on for the app');
  return r.data.id;
}

/** Leaderboard texts, per locale. */
const BOARD_TEXT = {
  [LEADERBOARDS.week]: {
    ref: 'Games hosted this week',
    'en-US': 'Most games hosted this week',
    'ar-SA': 'أكثر الألعاب إدارةً هذا الأسبوع',
    ru: 'Больше всех игр за неделю',
  },
  [LEADERBOARDS.month]: {
    ref: 'Games hosted this month',
    'en-US': 'Most games hosted this month',
    'ar-SA': 'أكثر الألعاب إدارةً هذا الشهر',
    ru: 'Больше всех игр за месяц',
  },
};

/** Recurrence attempts per leaderboard; the first form Apple accepts is used. */
const RECURRENCE = {
  [LEADERBOARDS.week]: [
    { recurrenceStartDate: '2026-10-12T00:00:00.000Z', recurrenceDuration: 'P7DT0H0M0S', recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1' },
    { recurrenceStartDate: '2026-10-12T00:00:00.000Z', recurrenceDuration: 'P7DT0H0M0S', recurrenceRule: 'FREQ=DAILY;INTERVAL=7' },
    { recurrenceStartDate: '2026-10-12T00:00:00.000Z', recurrenceDuration: 'P0Y0M7DT0H0M0S', recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1' },
  ],
  [LEADERBOARDS.month]: [
    { recurrenceStartDate: '2026-10-01T00:00:00.000Z', recurrenceDuration: 'P1MT0H0M0S', recurrenceRule: 'FREQ=MONTHLY;INTERVAL=1' },
    { recurrenceStartDate: '2026-10-01T00:00:00.000Z', recurrenceDuration: 'P0Y1M0DT0H0M0S', recurrenceRule: 'FREQ=MONTHLY;INTERVAL=1' },
    { recurrenceStartDate: '2026-10-01T00:00:00.000Z', recurrenceDuration: 'P30DT0H0M0S', recurrenceRule: 'FREQ=MONTHLY;INTERVAL=1' },
    { recurrenceStartDate: '2026-10-01T00:00:00.000Z', recurrenceDuration: 'P28DT0H0M0S', recurrenceRule: 'FREQ=DAILY;INTERVAL=28' },
  ],
};

async function leaderboards(detailId) {
  const existing = await all(`/v1/gameCenterDetails/${detailId}/gameCenterLeaderboards?limit=200`);
  for (const vendorIdentifier of Object.values(LEADERBOARDS)) {
    const text = BOARD_TEXT[vendorIdentifier];
    let board = existing.find((b) => b.attributes.vendorIdentifier === vendorIdentifier);
    if (!board) {
      for (const recurrence of RECURRENCE[vendorIdentifier]) {
        try {
          board = (await api('POST', '/v1/gameCenterLeaderboards', {
            data: {
              type: 'gameCenterLeaderboards',
              attributes: {
                referenceName: text.ref,
                vendorIdentifier,
                defaultFormatter: 'INTEGER',
                submissionType: 'BEST_SCORE',
                scoreSortType: 'DESC',
                scoreRangeStart: '0',
                scoreRangeEnd: '100000',
                ...recurrence,
              },
              relationships: { gameCenterDetail: rel('gameCenterDetails', detailId) },
            },
          })).data;
          log(`leaderboard created: ${vendorIdentifier} (${JSON.stringify(recurrence)})`);
          break;
        } catch (e) {
          log(`leaderboard ${vendorIdentifier} with ${JSON.stringify(recurrence)} refused: ${e.message}`);
        }
      }
      if (!board) {
        warn(`could not create leaderboard ${vendorIdentifier}`);
        continue;
      }
    } else {
      log(`leaderboard exists: ${vendorIdentifier}`);
    }
    const locs = await all(`/v1/gameCenterLeaderboards/${board.id}/localizations?limit=50`);
    for (const locale of Object.keys(LOCALES)) {
      if (locs.some((l) => l.attributes.locale === locale)) continue;
      try {
        await api('POST', '/v1/gameCenterLeaderboardLocalizations', {
          data: {
            type: 'gameCenterLeaderboardLocalizations',
            attributes: { locale, name: text[locale] },
            relationships: { gameCenterLeaderboard: rel('gameCenterLeaderboards', board.id) },
          },
        });
        log(`  ${locale}: ${text[locale]}`);
      } catch (e) {
        warn(`leaderboard ${vendorIdentifier} ${locale}: ${e.message}`);
      }
    }
  }
}

async function uploadImage(localizationId, file) {
  const bytes = readFileSync(file);
  const res = await api('POST', '/v1/gameCenterAchievementImages', {
    data: {
      type: 'gameCenterAchievementImages',
      attributes: { fileName: file.split('/').pop(), fileSize: statSync(file).size },
      relationships: { gameCenterAchievementLocalization: rel('gameCenterAchievementLocalizations', localizationId) },
    },
  });
  for (const op of res.data.attributes.uploadOperations || []) {
    const headers = Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value]));
    const r = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) });
    if (!r.ok) throw new Error(`image upload → ${r.status}`);
  }
  await api('PATCH', `/v1/gameCenterAchievementImages/${res.data.id}`, {
    data: { type: 'gameCenterAchievementImages', id: res.data.id, attributes: { uploaded: true } },
  });
}

async function achievements(detailId) {
  const existing = await all(`/v1/gameCenterDetails/${detailId}/gameCenterAchievements?limit=200`);
  for (const medal of MEDALS) {
    let ach = existing.find((a) => a.attributes.vendorIdentifier === medal.id);
    if (!ach) {
      try {
        ach = (await api('POST', '/v1/gameCenterAchievements', {
          data: {
            type: 'gameCenterAchievements',
            attributes: {
              referenceName: plain(en[`medal.${medal.key}`]),
              vendorIdentifier: medal.id,
              points: medal.points,
              showBeforeEarned: true,
              repeatable: false,
            },
            relationships: { gameCenterDetail: rel('gameCenterDetails', detailId) },
          },
        })).data;
        log(`achievement created: ${medal.id} (${medal.points} points)`);
      } catch (e) {
        warn(`achievement ${medal.id}: ${e.message}`);
        continue;
      }
    } else {
      log(`achievement exists: ${medal.id}`);
    }
    const locs = await all(`/v1/gameCenterAchievements/${ach.id}/localizations?limit=50`);
    for (const [locale, table] of Object.entries(LOCALES)) {
      let loc = locs.find((l) => l.attributes.locale === locale);
      try {
        if (!loc) {
          const desc = plain(table[`medal.${medal.key}.desc`]);
          loc = (await api('POST', '/v1/gameCenterAchievementLocalizations', {
            data: {
              type: 'gameCenterAchievementLocalizations',
              attributes: {
                locale,
                name: plain(table[`medal.${medal.key}`]),
                beforeEarnedDescription: desc,
                afterEarnedDescription: desc,
              },
              relationships: { gameCenterAchievement: rel('gameCenterAchievements', ach.id) },
            },
          })).data;
          log(`  ${locale}: ${table[`medal.${medal.key}`]}`);
        }
        const image = await api('GET', `/v1/gameCenterAchievementLocalizations/${loc.id}/gameCenterAchievementImage`).catch(() => null);
        if (!image?.data) {
          await uploadImage(loc.id, `${ROOT}mobile/gamecenter/medals/${medal.key}.png`);
          log(`  ${locale}: image uploaded`);
        }
      } catch (e) {
        warn(`achievement ${medal.id} ${locale}: ${e.message}`);
      }
    }
  }
}

try {
  const apps = await api('GET', `/v1/apps?filter[bundleId]=${BUNDLE_ID}&limit=5`);
  const app = apps.data.find((a) => a.attributes.bundleId === BUNDLE_ID);
  if (!app) throw new Error(`no app with bundle id ${BUNDLE_ID} in App Store Connect`);
  log(`app: ${app.attributes.name} (${app.id})`);
  const detailId = await gameCenterDetail(app.id);
  await leaderboards(detailId);
  await achievements(detailId);
  log(problems ? `done with ${problems} problem(s); see the warnings above` : 'Game Center is set up');
  if (problems) process.exit(1);
} catch (e) {
  console.error(`::error::${e.message}`);
  process.exit(1);
}
