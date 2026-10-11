import fa from './locales/fa.json';

// Phase 1 ships Persian only. English/Arabic are added later by dropping
// a new locale file here and registering it — components never hardcode
// strings, they always go through t().
export type Locale = 'fa';

const dictionaries: Record<Locale, Record<string, string>> = { fa };

export function t(key: keyof typeof fa, locale: Locale = 'fa'): string {
  return dictionaries[locale][key] ?? key;
}

export const defaultLocale: Locale = 'fa';
export const defaultDirection: 'rtl' | 'ltr' = 'rtl';
