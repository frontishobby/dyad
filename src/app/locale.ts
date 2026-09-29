/**
 * UI languages, framework-free. English is the default; a first visit follows
 * the browser's language list (navigator.languages, the same list the browser
 * sends as Accept-Language) until the player picks one in settings.
 */

export const LOCALES = ['en', 'ko', 'ja', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Each language named in itself, so the picker reads in any UI language. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  zh: '简体中文',
};

/** Value for <html lang>. Chinese is written in simplified characters. */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: 'en',
  ko: 'ko',
  ja: 'ja',
  zh: 'zh-Hans',
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/**
 * First supported language in the browser's preference order, by primary
 * subtag (ko-KR → ko, zh-TW → zh). Nothing supported → English.
 */
export function detectLocale(languages: readonly string[] | null | undefined): Locale {
  for (const tag of languages ?? []) {
    const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/** The browser's list, or nothing outside a browser. */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages?.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}
