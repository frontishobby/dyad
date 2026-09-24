/**
 * Screen router (PLAN §9). One rune holds the current screen and its params;
 * App.svelte renders the matching component. Every go() replaces the object,
 * so the target screen mounts fresh (no stale play state).
 */
import type { PlayResult } from '../core/types.ts';
import type { SongChartRef, SongMeta } from './types.ts';

export type Screen =
  | { name: 'boot' }
  | { name: 'title' }
  | { name: 'settings' }
  | { name: 'calibrate'; returnTo: 'title' | 'settings' }
  | { name: 'play'; song: SongMeta; chart: SongChartRef }
  | {
      name: 'result';
      song: SongMeta;
      chart: SongChartRef;
      result: PlayResult;
      best: PlayResult | null;
      isNewBest: boolean;
    };

let current = $state.raw<Screen>({ name: 'boot' });

export const screen: {
  readonly current: Screen;
  go(next: Screen): void;
} = {
  get current() {
    return current;
  },
  go(next: Screen): void {
    current = next;
  },
};
