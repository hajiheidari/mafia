import { describe, test, expect } from 'vitest';
// @ts-expect-error plain JS modules shipped as-is to the static host
import fa from '../../web/tool/lang/fa.js';
// @ts-expect-error plain JS modules shipped as-is to the static host
import en from '../../web/tool/lang/en.js';
// @ts-expect-error plain JS modules shipped as-is to the static host
import ar from '../../web/tool/lang/ar.js';
// @ts-expect-error plain JS modules shipped as-is to the static host
import ru from '../../web/tool/lang/ru.js';
// @ts-expect-error plain JS modules shipped as-is to the static host
import ur from '../../web/tool/lang/ur.js';
// @ts-expect-error plain JS modules shipped as-is to the static host
import { SCENARIOS, SCENARIO_ROLES } from '../../web/tool/scenarios.js';

type Table = Record<string, string | Record<string, string>>;
const TABLES: Record<string, Table> = { fa, en, ar, ru, ur };
const forms = (v: Table[string]) => (typeof v === 'string' ? [v] : Object.values(v));
const holes = (v: Table[string]) => new Set(forms(v).flatMap((s) => s.match(/\{\w+\}/g) ?? []));
// Scenario texts exist only in the languages that offer the scenario.
const isScenarioKey = (k: string) => k.startsWith('sc.') || k.startsWith('sr.');
const uiKeys = Object.keys(en).filter((k) => !isScenarioKey(k));

describe('language files', () => {
  test.each(Object.keys(TABLES))('%s has every interface text, with the same placeholders', (code) => {
    const table = TABLES[code]!;
    expect(uiKeys.filter((k) => !(k in table))).toEqual([]);
    expect(Object.keys(table).filter((k) => !isScenarioKey(k) && !(k in en))).toEqual([]);
    for (const k of uiKeys) {
      const want = holes(en[k]);
      // Plural forms may spell the count out (e.g. Arabic "لاعبان"), so {n} may be missing in some forms.
      const got = holes(table[k]!);
      for (const h of want) if (h !== '{n}') expect(got.has(h), `${code} ${k} ${h}`).toBe(true);
      for (const h of got) expect(want.has(h), `${code} ${k} extra ${h}`).toBe(true);
    }
  });

  test.each(Object.keys(TABLES))('%s plural forms use valid categories and always have "other"', (code) => {
    const valid = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    for (const [k, v] of Object.entries(TABLES[code]!)) {
      if (typeof v === 'string') continue;
      expect(Object.keys(v).every((c) => valid.includes(c as Intl.LDMLPluralRule)), `${code} ${k}`).toBe(true);
      expect(v.other, `${code} ${k}`).toBeTruthy();
    }
  });

  test('every scenario has its name, summary and role texts in each language that offers it', () => {
    for (const sc of SCENARIOS) {
      for (const code of sc.langs) {
        const table = TABLES[code]!;
        expect(table[`sc.${sc.id}`], `${code} sc.${sc.id}`).toBeTruthy();
        expect(table[`sc.${sc.id}.summary`], `${code} sc.${sc.id}.summary`).toBeTruthy();
        for (const r of SCENARIO_ROLES.filter((x: { scenario: string }) => x.scenario === sc.id)) {
          expect(table[`sr.${r.id}`], `${code} sr.${r.id}`).toBeTruthy();
          expect(table[`sr.${r.id}.desc`], `${code} sr.${r.id}.desc`).toBeTruthy();
        }
      }
    }
  });

  test('Urdu uses Urdu letters, not Arabic kaf/yeh', () => {
    const text = Object.values(ur).flatMap(forms).join(' ');
    expect(text).not.toMatch(/[كي]/);
  });
});
