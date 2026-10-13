// Languages of the narrator tool. Each language is a flat table of keys
// (lang/<code>.js). A value is a string with {placeholders}, or — for text
// that depends on a count — an object of plural forms keyed by
// Intl.PluralRules categories (zero, one, two, few, many, other), chosen by
// the `n` placeholder. Missing keys fall back to English, then Persian.
import fa from './lang/fa.js';
import en from './lang/en.js';
import ar from './lang/ar.js';
import ru from './lang/ru.js';

export const LANGS = {
  fa: { name: 'فارسی', dir: 'rtl', digits: '۰۱۲۳۴۵۶۷۸۹', table: fa },
  en: { name: 'English', dir: 'ltr', digits: null, table: en },
  ar: { name: 'العربية', dir: 'rtl', digits: '٠١٢٣٤٥٦٧٨٩', table: ar },
  ru: { name: 'Русский', dir: 'ltr', digits: null, table: ru },
};

const LANG_KEY = 'mafia-tool-lang';
let lang = 'fa';
let plural = new Intl.PluralRules('fa');

/**
 * The language asked for in the link, else the saved choice, else Persian
 * in Iran (many Iranian phones are set to English), else the first phone
 * language the tool speaks, else English.
 */
export function detectLang() {
  // A link from a landing page (?lang=ru) chooses the language and is remembered.
  const asked = new URLSearchParams(location.search).get('lang');
  if (LANGS[asked]) {
    try { localStorage.setItem(LANG_KEY, asked); } catch { /* ignore */ }
    return asked;
  }
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (LANGS[saved]) return saved;
  } catch { /* storage unavailable */ }
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* ignore */ }
  if (tz === 'Asia/Tehran' || /\.ir$/.test(location.hostname)) return 'fa';
  for (const l of navigator.languages || [navigator.language || '']) {
    const code = String(l).toLowerCase().split('-')[0];
    if (LANGS[code]) return code;
  }
  return 'en';
}

export function setLang(code, { remember = false } = {}) {
  lang = LANGS[code] ? code : 'en';
  plural = new Intl.PluralRules(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = LANGS[lang].dir;
  if (remember) {
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
  }
}

export const getLang = () => lang;
export const isRtl = () => LANGS[lang].dir === 'rtl';

/** Digits in the language's own script. */
export function num(value) {
  const digits = LANGS[lang].digits;
  const s = String(value);
  return digits ? s.replace(/\d/g, (d) => digits[d]) : s;
}

function lookup(key) {
  return LANGS[lang].table[key] ?? en[key] ?? fa[key];
}

/** True when the key exists in some language (used for optional scenario text). */
export const has = (key) => lookup(key) !== undefined;

/**
 * Translated text. Numbers in `vars` are written with the language's digits;
 * other values are inserted as given (callers escape user text).
 */
export function t(key, vars = {}) {
  let s = lookup(key);
  if (s === undefined) return key;
  if (typeof s === 'object') s = s[plural.select(Number(vars.n ?? 0))] ?? s.other;
  return s.replace(/\{(\w+)\}/g, (m, k) => {
    const v = vars[k];
    if (v === undefined) return m;
    return typeof v === 'number' ? num(v) : String(v);
  });
}

/** Joins a list the way the language does (، in Persian and Arabic, comma otherwise). */
export const joinList = (items) => items.join(t('list.sep'));

/** Arrow pointing back / forward in the reading direction. */
export const arrowBack = () => (isRtl() ? '→' : '←');
export const arrowNext = () => (isRtl() ? '←' : '→');
