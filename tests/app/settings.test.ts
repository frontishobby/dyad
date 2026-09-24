import { describe, expect, it } from 'vitest';
import {
  SETTINGS_KEY,
  cloneSettings,
  loadSettings,
  mergeSettings,
  parseSettings,
  saveSettings,
  toBindings,
  validateSettings,
} from '../../src/app/settings-io.ts';
import { DEFAULT_SETTINGS } from '../../src/app/types.ts';
import { createMemoryStorage } from '../../src/backend/storage.ts';

describe('validateSettings', () => {
  it('returns a copy of the defaults for non-objects', () => {
    for (const raw of [null, undefined, 42, 'x', [], true]) {
      const s = validateSettings(raw);
      expect(s).toEqual(DEFAULT_SETTINGS);
      expect(s).not.toBe(DEFAULT_SETTINGS);
      expect(s.bindings).not.toBe(DEFAULT_SETTINGS.bindings);
    }
  });

  it('drops unknown keys', () => {
    const s = validateSettings({ hiSpeed: 2, bogus: 1, nested: { x: 1 } }) as unknown as Record<string, unknown>;
    expect(Object.keys(s).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
    expect(s.bogus).toBeUndefined();
  });

  it('coerces numeric strings and clamps ranges', () => {
    const s = validateSettings({
      hiSpeed: '2.5',
      audioOffset: ' -12 ',
      inputOffset: '9999',
      hitSoundVolume: '1.7',
    });
    expect(s.hiSpeed).toBe(2.5);
    expect(s.audioOffset).toBe(-12);
    expect(s.inputOffset).toBe(500);
    expect(s.hitSoundVolume).toBe(1);
  });

  it('rounds hiSpeed to 0.1, offsets to whole ms, volume to 0.01', () => {
    const s = validateSettings({ hiSpeed: 1.2000000001, audioOffset: 12.6, hitSoundVolume: 0.333 });
    expect(s.hiSpeed).toBe(1.2);
    expect(s.audioOffset).toBe(13);
    expect(s.hitSoundVolume).toBe(0.33);
  });

  it('falls back per field on garbage', () => {
    const s = validateSettings({
      hiSpeed: 'fast',
      audioOffset: NaN,
      inputOffset: Infinity,
      theme: 'sepia',
      hitSoundVolume: {},
      calibrated: null,
    });
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('accepts booleans in string and 0/1 form', () => {
    expect(validateSettings({ calibrated: 1 }).calibrated).toBe(true);
    expect(validateSettings({ calibrated: 'false' }).calibrated).toBe(false);
  });

  it('accepts only dark or light themes', () => {
    expect(validateSettings({ theme: 'light' }).theme).toBe('light');
    expect(validateSettings({ theme: 'DARK' }).theme).toBe('dark');
  });
});

describe('toBindings', () => {
  it('merges partial bindings over the base', () => {
    const b = toBindings({ KL: 'KeyQ' }, DEFAULT_SETTINGS.bindings);
    expect(b).toEqual({ KL: 'KeyQ', KR: 'Comma', DL: 'KeyX', DR: 'KeyM' });
  });

  it('rejects codes that are not KeyboardEvent.code identifiers', () => {
    const b = toBindings({ KL: '', KR: 'Key R', DL: 42, DR: 'KeyP' }, DEFAULT_SETTINGS.bindings);
    expect(b).toEqual({ KL: 'KeyZ', KR: 'Comma', DL: 'KeyX', DR: 'KeyP' });
  });

  it('falls back to the base set when two pad keys share a code', () => {
    const b = toBindings({ KL: 'Comma' }, DEFAULT_SETTINGS.bindings);
    expect(b).toEqual(DEFAULT_SETTINGS.bindings);
  });

  it('treats the first shipped defaults (R U / F J) as unset, so they follow the new defaults', () => {
    const b = toBindings({ KL: 'KeyR', KR: 'KeyU', DL: 'KeyF', DR: 'KeyJ' }, DEFAULT_SETTINGS.bindings);
    expect(b).toEqual(DEFAULT_SETTINGS.bindings);
    // A deliberate custom set that merely overlaps is kept.
    expect(toBindings({ KL: 'KeyR', KR: 'KeyU', DL: 'KeyF', DR: 'KeyK' }, DEFAULT_SETTINGS.bindings)).toEqual({ KL: 'KeyR', KR: 'KeyU', DL: 'KeyF', DR: 'KeyK' });
  });

  it('ignores unknown pad keys', () => {
    const b = toBindings({ XX: 'KeyA' }, DEFAULT_SETTINGS.bindings) as Record<string, string>;
    expect(b.XX).toBeUndefined();
  });
});

describe('mergeSettings', () => {
  it('keeps current values for fields absent from the patch', () => {
    const base = { ...cloneSettings(DEFAULT_SETTINGS), hiSpeed: 2, calibrated: true };
    const merged = mergeSettings(base, { theme: 'light' });
    expect(merged.hiSpeed).toBe(2);
    expect(merged.calibrated).toBe(true);
    expect(merged.theme).toBe('light');
  });

  it('validates the patch against the current value, not the defaults', () => {
    const base = { ...cloneSettings(DEFAULT_SETTINGS), hiSpeed: 2 };
    expect(mergeSettings(base, { hiSpeed: Number.NaN }).hiSpeed).toBe(2);
  });

  it('does not alias the base object', () => {
    const base = cloneSettings(DEFAULT_SETTINGS);
    const merged = mergeSettings(base, {});
    expect(merged).not.toBe(base);
    expect(merged.bindings).not.toBe(base.bindings);
  });
});

describe('parseSettings / loadSettings / saveSettings', () => {
  it('yields defaults for missing, empty or corrupt JSON', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('"a string"')).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips through a Storage', () => {
    const storage = createMemoryStorage();
    const s = { ...cloneSettings(DEFAULT_SETTINGS), hiSpeed: 1.5, theme: 'light' as const, calibrated: true };
    expect(saveSettings(storage, s)).toBe(true);
    expect(JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}')).toEqual(s);
    expect(loadSettings(storage)).toEqual(s);
  });

  it('merges stored partial objects over the defaults', () => {
    const storage = createMemoryStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ hiSpeed: 2, bindings: { DL: 'KeyD' }, legacy: true }));
    const s = loadSettings(storage);
    expect(s.hiSpeed).toBe(2);
    expect(s.bindings).toEqual({ KL: 'KeyZ', KR: 'Comma', DL: 'KeyD', DR: 'KeyM' });
    expect(s.theme).toBe('dark');
    expect('legacy' in s).toBe(false);
  });

  it('survives a storage that throws', () => {
    const throwing = {
      getItem(): string | null {
        throw new Error('blocked');
      },
      setItem(): void {
        throw new Error('quota');
      },
    };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(throwing, DEFAULT_SETTINGS)).toBe(false);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(undefined, DEFAULT_SETTINGS)).toBe(false);
  });

  it('never writes invalid values even when handed them', () => {
    const storage = createMemoryStorage();
    const bad = { ...cloneSettings(DEFAULT_SETTINGS), hiSpeed: 99 };
    saveSettings(storage, bad);
    expect(loadSettings(storage).hiSpeed).toBe(3);
  });
});
