/**
 * Play orientation decision (PLAN §8).
 *
 * Portrait (touch) only when the viewport is portrait AND the primary pointer
 * is coarse; everything else (desktop windows taller than wide, phones with a
 * mouse) plays landscape with keyboard / gamepad. The decision is made once on
 * entry and locked for the whole play.
 */
import type { Orientation } from '../../render/types.ts';

export interface OrientationSignals {
  /** matchMedia('(orientation: portrait)').matches */
  portraitMedia: boolean;
  /** matchMedia('(pointer: coarse)').matches */
  coarsePointer: boolean;
}

export const PORTRAIT_QUERY = '(orientation: portrait)';
export const COARSE_POINTER_QUERY = '(pointer: coarse)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function decideOrientation(portraitMedia: boolean, coarsePointer: boolean): Orientation {
  return portraitMedia && coarsePointer ? 'portrait' : 'landscape';
}

/** Evaluate a media query; false when matchMedia is unavailable (tests, SSR). */
export function mediaMatches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

export function readOrientationSignals(): OrientationSignals {
  return {
    portraitMedia: mediaMatches(PORTRAIT_QUERY),
    coarsePointer: mediaMatches(COARSE_POINTER_QUERY),
  };
}

/** screen.orientation.lock() argument for a play orientation. */
export function lockTypeFor(orientation: Orientation): OrientationLockType {
  return orientation;
}
