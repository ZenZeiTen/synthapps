/**
 * The app language. Text comes from t(), which returns the dictionary for
 * the current language. The language is module state so that plain
 * functions (grading, insights, the PDF) can use it without threading it
 * through every call; React screens re-render when the setting changes.
 */
import { en, type Dict } from './en';
import { id } from './id';

export type Lang = 'en' | 'id';
export const LANGS: Lang[] = ['en', 'id'];

const DICTS: Record<Lang, Dict> = { en, id };
let current: Lang = 'en';

export function setLang(l: Lang): void {
  current = l;
  if (typeof document !== 'undefined') document.documentElement.lang = DICTS[l].meta.htmlLang;
}

export function getLang(): Lang {
  return current;
}

export function t(): Dict {
  return DICTS[current];
}

export function dictFor(l: Lang): Dict {
  return DICTS[l];
}

export function locale(): string {
  return DICTS[current].meta.locale;
}

/** Indonesian for people whose device is set to Indonesian, English otherwise. */
export function detectLang(): Lang {
  const langs = typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : [];
  return langs.some((l) => /^(id|in)\b/i.test(l ?? '')) ? 'id' : 'en';
}

/**
 * Formats a number for display: a decimal point in English, a decimal comma
 * in Indonesian. No thousands separators, so values stay compact in charts.
 */
export function num(v: number, decimals = 0): string {
  if (!Number.isFinite(v)) return '-';
  const s = v.toFixed(decimals);
  return current === 'id' ? s.replace('.', ',') : s;
}

/** Number with a sign: +5, -2,4, or 0. */
export function signedNum(v: number, decimals = 0): string {
  const s = num(v, decimals);
  if (Number(v.toFixed(decimals)) === 0) return num(0, decimals);
  return v > 0 ? `+${s}` : s;
}

export type { Dict };
