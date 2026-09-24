/**
 * Settings persistence, framework-free (PLAN §9).
 *
 * Stored JSON is never trusted: unknown keys are dropped, numbers are coerced
 * and clamped, anything else falls back to the base (defaults on load, the
 * current value on update). The rune store in settings.svelte.ts is a thin
 * wrapper over these functions so they can be unit-tested without Svelte.
 */
import { KEYS, type Key } from '../core/types.ts';
import type { KeyBindings } from '../input/types.ts';
import { DEFAULT_SETTINGS, type Settings } from './types.ts';

export const SETTINGS_KEY = 'dyad:settings';

/** Inclusive ranges the UI and the validator agree on. */
export const SETTINGS_RANGE = {
  hiSpeed: { min: 0.5, max: 3, step: 0.1 },
  offsetMs: { min: -500, max: 500, step: 1 },
  volume: { min: 0, max: 1, step: 0.05 },
} as const;

/** KeyboardEvent.code values are ASCII identifiers such as KeyR, Digit1, ArrowUp, NumpadAdd. */
const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,31}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Finite number, accepting numeric strings ("12", " -3.5 "). */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function toBoolean(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1) return true;
  if (v === 'false' || v === 0) return false;
  return fallback;
}

function toTheme(v: unknown, fallback: Settings['theme']): Settings['theme'] {
  return v === 'dark' || v === 'light' ? v : fallback;
}

export function isKeyCode(v: unknown): v is string {
  return typeof v === 'string' && CODE_PATTERN.test(v);
}

/**
 * Per-key fallback to `base`; if the result maps two pad keys to the same
 * code the whole set falls back (the settings screen swaps instead, so this
 * only triggers on hand-edited or corrupt storage).
 */
/** The first shipped defaults (R U / F J). Stored settings that still hold exactly these follow the new defaults. */
const LEGACY_DEFAULT_BINDINGS: KeyBindings = { KL: 'KeyR', KR: 'KeyU', DL: 'KeyF', DR: 'KeyJ' };

function isLegacyDefault(v: Record<string, unknown>): boolean {
  return KEYS.every((k: Key) => v[k] === LEGACY_DEFAULT_BINDINGS[k]);
}

export function toBindings(v: unknown, base: KeyBindings): KeyBindings {
  const out: KeyBindings = { ...base };
  if (isRecord(v) && isLegacyDefault(v)) return out;
  if (isRecord(v)) {
    for (const key of KEYS) {
      const code = v[key];
      if (isKeyCode(code)) out[key] = code;
    }
  }
  const codes = new Set<string>(KEYS.map((k: Key) => out[k]));
  return codes.size === KEYS.length ? out : { ...base };
}

export function toHiSpeed(v: unknown, fallback: number): number {
  const n = toNumber(v);
  if (n === null) return fallback;
  const { min, max } = SETTINGS_RANGE.hiSpeed;
  return roundTo(clamp(n, min, max), 1);
}

export function toOffsetMs(v: unknown, fallback: number): number {
  const n = toNumber(v);
  if (n === null) return fallback;
  const { min, max } = SETTINGS_RANGE.offsetMs;
  return Math.round(clamp(n, min, max));
}

export function toVolume(v: unknown, fallback: number): number {
  const n = toNumber(v);
  if (n === null) return fallback;
  const { min, max } = SETTINGS_RANGE.volume;
  return roundTo(clamp(n, min, max), 2);
}

/** Deep copy (bindings is the only nested object). */
export function cloneSettings(s: Settings): Settings {
  return { ...s, bindings: { ...s.bindings } };
}

/**
 * Build a valid Settings from untrusted input, field by field over `base`.
 * Unknown keys are dropped by construction.
 */
export function validateSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  if (!isRecord(raw)) return cloneSettings(base);
  return {
    bindings: toBindings(raw.bindings, base.bindings),
    audioOffset: toOffsetMs(raw.audioOffset, base.audioOffset),
    inputOffset: toOffsetMs(raw.inputOffset, base.inputOffset),
    hiSpeed: toHiSpeed(raw.hiSpeed, base.hiSpeed),
    theme: toTheme(raw.theme, base.theme),
    hitSoundVolume: toVolume(raw.hitSoundVolume, base.hitSoundVolume),
    calibrated: toBoolean(raw.calibrated, base.calibrated),
  };
}

/** Apply a partial update. Fields absent from `patch` keep their current value. */
export function mergeSettings(base: Settings, patch: Partial<Settings>): Settings {
  return validateSettings(patch, base);
}

/** Parse stored JSON; corrupt or missing text yields the defaults. */
export function parseSettings(json: string | null | undefined): Settings {
  if (typeof json !== 'string' || json === '') return cloneSettings(DEFAULT_SETTINGS);
  try {
    return validateSettings(JSON.parse(json));
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | null | undefined): Settings {
  if (!storage) return cloneSettings(DEFAULT_SETTINGS);
  try {
    return parseSettings(storage.getItem(SETTINGS_KEY));
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

/** Returns false when the storage refused the write (quota, blocked). */
export function saveSettings(storage: Pick<Storage, 'setItem'> | null | undefined, settings: Settings): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(validateSettings(settings)));
    return true;
  } catch {
    return false;
  }
}
