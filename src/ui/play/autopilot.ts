/**
 * Autoplay: a scripted player that presses every object dead on time. Built
 * once from the chart into a sorted press schedule, then driven from the
 * frame loop (it stands in for the gamepad's poll(): presses land before the
 * tick of the same frame). Presses go through the same engine.hit() as a
 * human's, stamped with the object's own time, so the run is a perfect play
 * by construction. Nothing about it is recorded.
 */
import type { Chart, EngineEvent, Key, NoteKind } from '../../core/types.ts';
import { expectedRollTicks } from '../../core/engine.ts';
import { isBigHit } from './press.ts';

export interface AutoPress {
  t: number;
  key: Key;
}

/** Spinner taps come this often, alternating type. */
export const AUTO_SPINNER_INTERVAL_MS = 80;
/** A scripted key is shown held for this long (the ghost on the ring). */
export const AUTO_HOLD_MS = 60;

const KEYS: Record<NoteKind, readonly [Key, Key]> = { d: ['DL', 'DR'], k: ['KL', 'KR'] };

/** Every press a perfect play needs, sorted by time (ties keep object order). */
export function buildAutoSchedule(chart: Chart): AutoPress[] {
  const out: AutoPress[] = [];
  const hand: Record<NoteKind, 0 | 1> = { d: 0, k: 0 };
  for (const note of chart.notes) {
    const keys = KEYS[note.k];
    if (note.big) {
      out.push({ t: note.t, key: keys[0] }, { t: note.t, key: keys[1] });
    } else {
      out.push({ t: note.t, key: keys[hand[note.k]] });
      hand[note.k] = hand[note.k] === 0 ? 1 : 0;
    }
  }
  for (const roll of chart.rolls) {
    const ticks = expectedRollTicks(chart, roll.t, roll.end);
    const step = ticks > 1 ? (roll.end - roll.t) / ticks : 0;
    for (let i = 0; i < ticks; i++) {
      const t = Math.min(roll.end, Math.round(roll.t + i * step));
      out.push({ t, key: i % 2 === 0 ? 'DL' : 'DR' });
    }
  }
  for (const spinner of chart.spinners) {
    const needed = Math.max(1, spinner.hits);
    for (let i = 0; i < needed; i++) {
      const t = spinner.t + i * AUTO_SPINNER_INTERVAL_MS;
      if (t > spinner.end) break;
      out.push({ t, key: i % 2 === 0 ? 'DL' : 'KL' });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export interface AutoPilotSink {
  engine: { hit(key: Key, hitMs: number): EngineEvent[] };
  renderer: {
    press(key: Key, down: boolean): void;
    apply(events: readonly EngineEvent[], songMs: number): void;
  };
  hitSounds: { play(kind: NoteKind, big?: boolean): void };
  hud: { noteEvents(events: readonly EngineEvent[]): void };
}

export interface AutoPilot {
  /** Press everything due at or before `songMs`, release keys held long enough. Call once per frame, before the tick. */
  poll(songMs: number): void;
  /** Presses still to come. */
  readonly remaining: number;
}

export function createAutoPilot(schedule: readonly AutoPress[], sink: AutoPilotSink): AutoPilot {
  let next = 0;
  const heldUntil = new Map<Key, number>();
  return {
    get remaining() {
      return schedule.length - next;
    },
    poll(songMs) {
      for (const [key, until] of heldUntil) {
        if (songMs >= until) {
          heldUntil.delete(key);
          sink.renderer.press(key, false);
        }
      }
      while (next < schedule.length && (schedule[next] as AutoPress).t <= songMs) {
        const { t, key } = schedule[next] as AutoPress;
        next++;
        sink.renderer.press(key, true);
        heldUntil.set(key, t + AUTO_HOLD_MS);
        const events = sink.engine.hit(key, t);
        sink.hitSounds.play(key[0] === 'K' ? 'k' : 'd', isBigHit(events));
        sink.renderer.apply(events, t);
        sink.hud.noteEvents(events);
      }
    },
  };
}
