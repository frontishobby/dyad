/**
 * Song-select carousel maths (DESIGN §4). Pure: no DOM, no Svelte.
 *
 * The carousel has a continuous position (a spring) and an integer index it
 * settles on. Jackets are placed by their distance from the centre slot,
 * interpolated between STOPS, like ennea's song select.
 */
import { TIERS, type SongChartRef, type Tier } from './types.ts';

/** From this many songs the carousel wraps around (below it there is nothing to wrap to). */
export const WRAP_MIN = 2;

/** Reference jacket size the STOPS are measured against. */
export const JACKET_REF_PX = 340;
/** Below this viewport width the jacket shrinks to a fraction of the width. */
export const WIDE_VIEWPORT_PX = 900;
export const JACKET_FRACTION = 0.6;

export interface Stop {
  x: number;
  scale: number;
  opacity: number;
}

/** Where a jacket sits by its distance from the centre slot (at JACKET_REF_PX). */
export const STOPS: readonly Stop[] = [
  { x: 0, scale: 1, opacity: 1 },
  { x: 352, scale: 0.6, opacity: 1 },
  { x: 578, scale: 0.4, opacity: 0.8 },
  { x: 726, scale: 0.3, opacity: 0 },
];

export interface Placement {
  x: number;
  scale: number;
  opacity: number;
  z: number;
}

/** Jacket size for a viewport width: 340 px on wide screens, else 60 % of the width. */
export function jacketSize(viewportW: number): number {
  if (!(viewportW > 0)) return JACKET_REF_PX;
  return viewportW >= WIDE_VIEWPORT_PX ? JACKET_REF_PX : Math.round(viewportW * JACKET_FRACTION);
}

/** Interpolated placement for a signed slot offset; `ratio` scales the x stops (jacketSize / 340). */
export function place(offset: number, ratio = 1): Placement {
  const dist = Math.min(Math.abs(offset), STOPS.length - 1);
  const step = Math.min(Math.floor(dist), STOPS.length - 2);
  const t = dist - step;
  const a = STOPS[step] as Stop;
  const b = STOPS[step + 1] as Stop;
  const lerp = (u: number, v: number): number => u + (v - u) * t;
  return {
    x: Math.sign(offset) * lerp(a.x, b.x) * ratio,
    scale: lerp(a.scale, b.scale),
    opacity: lerp(a.opacity, b.opacity),
    z: 40 - Math.round(dist * 10),
  };
}

export function wraps(count: number): boolean {
  return count >= WRAP_MIN;
}

/** Signed slot distance to reach `delta` slots away, the short way round when wrapping. */
export function shortest(delta: number, count: number): number {
  if (!wraps(count)) return delta;
  const n = count;
  return (((delta % n) + n + n / 2) % n) - n / 2;
}

/** Next index after moving `delta` slots: wrapping (a single song stays put). */
export function stepIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  if (wraps(count)) return (((index + delta) % count) + count) % count;
  return Math.max(0, Math.min(count - 1, index + delta));
}

/** Songs do not all carry every tier: keep the player's preference and land on the closest chart that exists. */
export function nearestChart(charts: readonly SongChartRef[], want: Tier): SongChartRef | null {
  if (charts.length === 0) return null;
  const target = TIERS.indexOf(want);
  const distance = (c: SongChartRef): number => Math.abs(TIERS.indexOf(c.tier) - target);
  return charts.reduce((closest, c) => (distance(c) < distance(closest) ? c : closest));
}

/** The chart `delta` tiers up (+) or down (−) from `current` among those available, clamped. */
export function stepTier(charts: readonly SongChartRef[], current: SongChartRef | null, delta: number): SongChartRef | null {
  if (charts.length === 0) return null;
  const sorted = [...charts].sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
  const at = current ? sorted.findIndex((c) => c.hash === current.hash) : -1;
  const from = at >= 0 ? at : 0;
  const next = Math.max(0, Math.min(sorted.length - 1, from + delta));
  return sorted[next] ?? null;
}

/** −1 / 0 / +1 from a horizontal drag: past the threshold, a leftward drag means "next". */
export function swipeDirection(dx: number, threshold = 40): -1 | 0 | 1 {
  if (dx <= -threshold) return 1;
  if (dx >= threshold) return -1;
  return 0;
}

export interface WheelStepperOptions {
  /** Accumulated delta that counts as one step. */
  threshold?: number;
  /** Ignore further steps this long after one fires (inertial trackpads). */
  cooldownMs?: number;
  now?: () => number;
}

/**
 * Turn wheel deltas into single steps. Horizontal and vertical wheel both
 * browse; the larger axis wins per event. Returns the event handler.
 */
export function createWheelStepper(
  onStep: (dir: 1 | -1) => void,
  opts: WheelStepperOptions = {},
): (deltaX: number, deltaY: number) => void {
  const threshold = opts.threshold ?? 40;
  const cooldown = opts.cooldownMs ?? 160;
  const now = opts.now ?? (() => performance.now());
  let acc = 0;
  let lastStep = -Infinity;
  return (deltaX, deltaY) => {
    const d = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
    const t = now();
    if (t - lastStep < cooldown) {
      acc = 0;
      return;
    }
    acc += d;
    if (Math.abs(acc) >= threshold) {
      onStep(acc > 0 ? 1 : -1);
      acc = 0;
      lastStep = t;
    }
  };
}
