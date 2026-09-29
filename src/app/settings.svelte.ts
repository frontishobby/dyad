/**
 * Settings store (PLAN §9). Rune-backed; persisted to localStorage under
 * SETTINGS_KEY and merged over DEFAULT_SETTINGS on load (the language
 * defaulting to the browser's, see loadSettings).
 *
 * `value` is replaced wholesale on every update (no deep mutation), so
 * readers can treat it as an immutable snapshot and `update()` is the only
 * write path that also persists.
 */
import { safeLocalStorage } from '../backend/storage.ts';
import { browserLanguages } from './locale.ts';
import { cloneSettings, loadSettings, mergeSettings, saveSettings } from './settings-io.ts';
import { DEFAULT_SETTINGS, type Settings } from './types.ts';

const storage = safeLocalStorage();

let value = $state.raw<Settings>(loadSettings(storage, browserLanguages()));

export const settings: {
  readonly value: Settings;
  update(patch: Partial<Settings>): void;
  reset(): void;
} = {
  get value() {
    return value;
  },
  update(patch: Partial<Settings>): void {
    value = mergeSettings(value, patch);
    saveSettings(storage, value);
  },
  /** Everything back to the defaults except the language, which the player chose to read in. */
  reset(): void {
    value = { ...cloneSettings(DEFAULT_SETTINGS), locale: value.locale };
    saveSettings(storage, value);
  },
};
