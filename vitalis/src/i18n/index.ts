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

/** Manifest file per language, written by the build (see vite.config.ts). */
const MANIFEST: Record<Lang, string> = { en: './manifest.webmanifest', id: './manifest-id.webmanifest' };

export function setLang(l: Lang): void {
  current = l;
  if (typeof document === 'undefined') return;
  const d = DICTS[l];
  document.documentElement.lang = d.meta.htmlLang;
  // Install name and description: point the browser at this language's
  // manifest, so "Install app" and the home-screen name use it.
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (link && link.getAttribute('href') !== MANIFEST[l]) link.setAttribute('href', MANIFEST[l]);
  document.querySelector('meta[name="description"]')?.setAttribute('content', d.meta.installDescription);
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'Vitalis');
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
