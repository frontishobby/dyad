/**
 * Pure helpers behind Hud.svelte (DESIGN §3, §5). Kept out of the component so
 * the formatting and pulse rules are unit-testable without a DOM.
 */
import type { EngineEvent, Judgement } from '../../core/types.ts';
import type { Layout } from '../../render/types.ts';

/** Score is always 7 digits wide: "1,000,000" is the widest value. */
export const SCORE_DIGITS = 7;
/** U+2007 FIGURE SPACE: the width of one tabular digit. */
export const FIGURE_SPACE = ' ';
/** U+2008 PUNCTUATION SPACE: the width of a comma / period. */
export const PUNCTUATION_SPACE = ' ';

/** Combo brightens once every this many (DESIGN §5). */
export const COMBO_STEP = 50;
/** How long a judgement word stays on screen after the last judged note. */
export const JUDGEMENT_HOLD_MS = 500;
/** Progress is quantised so the bar only touches the DOM ~1000× per song. */
export const PROGRESS_STEPS = 1000;

/**
 * "  987,650" rather than "0,987,650" (DESIGN §3): every position of the
 * 7-digit, 2-comma shape is present, with leading zeros replaced by figure
 * spaces and leading commas by punctuation spaces, so the text never changes
 * width and right-aligned digits never jump.
 */
export function formatScore(score: number): string {
  const max = 10 ** SCORE_DIGITS - 1;
  const n = Number.isFinite(score) ? Math.min(max, Math.max(0, Math.round(score))) : 0;
  const padded = String(n).padStart(SCORE_DIGITS, '0');
  let out = '';
  let significant = false;
  for (let i = 0; i < SCORE_DIGITS; i++) {
    const ch = padded.charAt(i);
    // Groups of 1 | 3 | 3 → a separator before positions 1 and 4.
    if (i === 1 || i === 4) out += significant ? ',' : PUNCTUATION_SPACE;
    if (!significant && (ch !== '0' || i === SCORE_DIGITS - 1)) significant = true;
    out += significant ? ch : FIGURE_SPACE;
  }
  return out;
}

/** True when the combo grew across a multiple of `step` (49→50, 49→51, 0→100). Resets never pulse. */
export function crossedMilestone(prev: number, next: number, step = COMBO_STEP): boolean {
  if (!(next > prev) || step <= 0) return false;
  return Math.floor(next / step) > Math.floor(prev / step);
}

/** songMs / durationMs clamped to 0..1 and quantised to 1/steps. */
export function progressRatio(songMs: number, durationMs: number, steps = PROGRESS_STEPS): number {
  if (!(durationMs > 0) || !Number.isFinite(songMs)) return 0;
  const ratio = Math.min(1, Math.max(0, songMs / durationMs));
  return Math.round(ratio * steps) / steps;
}

/** The judgement of the last note event in a batch, or null when none was judged. */
export function latestJudgement(events: readonly EngineEvent[]): Judgement | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e !== undefined && e.type === 'note') return e.judgement;
  }
  return null;
}

/**
 * Where the judgement word sits (DESIGN §4: the only centred text). Portrait:
 * under the gate, centred on it. Landscape: under the track, centred on the
 * gate column. Returns the centre x and the top y, in logical px.
 */
export function judgementAnchor(layout: Layout): { x: number; y: number } {
  const x = layout.gate.x + layout.gate.w / 2;
  if (layout.orientation === 'portrait') {
    return { x, y: layout.gate.y + layout.gate.h + 16 };
  }
  return { x, y: layout.track.y + layout.track.h + 24 };
}

/** Text colour role for a judgement (DESIGN §1: judgement is brightness, not hue). */
export function judgementTone(j: Judgement): 'text' | 'text-dim' | 'text-faint' {
  switch (j) {
    case 'great':
      return 'text';
    case 'ok':
      return 'text-dim';
    case 'miss':
      return 'text-faint';
  }
}

/** Display word for a judgement; English, never translated (DESIGN §3). */
export function judgementWord(j: Judgement): string {
  switch (j) {
    case 'great':
      return 'Great';
    case 'ok':
      return 'OK';
    case 'miss':
      return 'Miss';
  }
}
