/**
 * Shared fixtures for the core tests. No Pixi, no DOM.
 */
import type {
  Chart,
  ChartNote,
  ChartRoll,
  ChartSpinner,
  Engine,
  EngineEvent,
  Hand,
  Judgement,
  Key,
  NoteKind,
  NoteView,
} from '../../src/core/types.ts';

export interface ChartSpec {
  notes?: ChartNote[];
  rolls?: ChartRoll[];
  spinners?: ChartSpinner[];
  od?: number;
}

export function chart(spec: ChartSpec = {}): Chart {
  return {
    version: 1,
    meta: { title: 'fixture', artist: 'tests', difficulty: 'Oni', bpm: [150, 150], od: spec.od ?? 5, hp: 5 },
    timing: [{ t: 0, beatLength: 400, meter: 4 }],
    notes: spec.notes ?? [],
    rolls: spec.rolls ?? [],
    spinners: spec.spinners ?? [],
    hash: 'fixture',
  };
}

export const note = (t: number, k: NoteKind = 'd', big = false): ChartNote => ({ t, k, big });
export const roll = (t: number, end: number, big = false): ChartRoll => ({ t, end, big });
export const spinner = (t: number, end: number, hits: number): ChartSpinner => ({ t, end, hits });

export function keyOf(kind: NoteKind, hand: Hand = 'L'): Key {
  return `${kind === 'd' ? 'D' : 'K'}${hand}` as Key;
}

export function noteEvent(
  index: number,
  judgement: Judgement,
  deltaMs: number | null,
  key: Key | null,
  big = false,
  strong = false,
): EngineEvent {
  return { type: 'note', index, judgement, deltaMs, key, big, strong };
}

/** Canonical, order-independent view of an event list (a sorted multiset). */
export function canonical(events: readonly EngineEvent[]): string[] {
  return events.map((e) => JSON.stringify(e, Object.keys(e).sort())).sort();
}

/** Snapshot of every NoteView (copies, so later mutation does not leak into assertions). */
export function views(engine: Engine): NoteView[] {
  return engine.chart.notes.map((_, i) => ({ ...engine.noteView(i) }));
}

/** mulberry32: small, seedable, good enough for property tests. Returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
