import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../src/app/i18n/index.ts';
import { LOCALES, detectLocale } from '../../src/app/locale.ts';

describe('detectLocale', () => {
  it('matches the primary subtag, case and separator insensitive', () => {
    expect(detectLocale(['ko-KR'])).toBe('ko');
    expect(detectLocale(['ja'])).toBe('ja');
    expect(detectLocale(['zh-TW'])).toBe('zh');
    expect(detectLocale(['ZH_hans_CN'])).toBe('zh');
    expect(detectLocale(['en-GB'])).toBe('en');
  });

  it('takes the first supported language in preference order', () => {
    expect(detectLocale(['fr-FR', 'ja-JP', 'ko-KR'])).toBe('ja');
    expect(detectLocale(['de', 'en-US', 'ko'])).toBe('en');
  });

  it('falls back to English when nothing is supported', () => {
    expect(detectLocale(['fr-FR', 'de'])).toBe('en');
    expect(detectLocale([])).toBe('en');
    expect(detectLocale(undefined)).toBe('en');
  });
});

describe('messages', () => {
  /** Every leaf path, with functions marked, so a missing or mistyped key shows up by name. */
  function shape(o: object, prefix = ''): string[] {
    return Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'object' && v !== null ? shape(v, `${prefix}${k}.`) : [`${prefix}${k}:${typeof v}`],
    );
  }

  it('has the same keys in every language, all non-empty', () => {
    const en = shape(MESSAGES.en).sort();
    for (const locale of LOCALES) {
      expect(shape(MESSAGES[locale]).sort(), locale).toEqual(en);
      for (const leaf of shape(MESSAGES[locale])) expect(leaf, locale).toMatch(/:(string|function)$/);
      const strings = JSON.stringify(MESSAGES[locale]);
      expect(strings, locale).not.toContain('""');
    }
  });

  it('interpolates arguments', () => {
    for (const locale of LOCALES) {
      expect(MESSAGES[locale].calibrate.tapGuide(8), locale).toContain('8');
      expect(MESSAGES[locale].tier.level('HARD', '7'), locale).toMatch(/HARD.*7/);
    }
  });
});
