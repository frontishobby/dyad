/**
 * Settings store (PLAN §9). Rune-backed; persisted to localStorage under
 * SETTINGS_KEY and merged over DEFAULT_SETTINGS on load.
 *
 * `value` is replaced wholesale on every update (no deep mutation), so
 * readers can treat it as an immutable snapshot and `update()` is the only
 * write path that also persists.
 */
import { safeLocalStorage } from '../backend/storage.ts';
import { cloneSettings, loadSettings, mergeSettings, saveSettings } from './settings-io.ts';
import { DEFAULT_SETTINGS, type Settings } from './types.ts';

const storage = safeLocalStorage();

let value = $state.raw<Settings>(loadSettings(storage));

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
  reset(): void {
    value = cloneSettings(DEFAULT_SETTINGS);
    saveSettings(storage, value);
  },
};
