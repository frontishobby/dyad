/**
 * Judgement timeline (result screen graph). Pure: replays the input log
 * through the engine, then reads every note's settled judgement, so the
 * per-note data is a function of (chart, config, log) exactly like the score.
 */
import { createEngine } from './engine.ts';
import type { Chart, EngineConfig, InputLogEntry, Judgement } from './types.ts';

export interface TimelinePoint {
  /** Note time, ms. */
  t: number;
  judgement: Judgement;
  /** Running accuracy (notes only) after this note, 0..1. */
  accuracy: number;
}

/** Note weight per judgement (PLAN §2). */
export function earnedFor(judgement: Judgement): number {
  return judgement === 'great' ? 1 : judgement === 'ok' ? 0.5 : 0;
}

/** Every note in chart order with its judgement and the accuracy so far. */
export function judgementTimeline(chart: Chart, config: EngineConfig, log: readonly InputLogEntry[]): TimelinePoint[] {
  const engine = createEngine(chart, config);
  const presses = log.slice().sort((a, b) => a[0] - b[0]);
  let last = 0;
  for (const [t, key] of presses) {
    engine.hit(key, t);
    if (t > last) last = t;
  }
  for (const note of chart.notes) if (note.t > last) last = note.t;
  for (const roll of chart.rolls) if (roll.end > last) last = roll.end;
  for (const spinner of chart.spinners) if (spinner.end > last) last = spinner.end;
  engine.tick(last + config.windows.miss + config.bigWindowMs + 1);

  const out: TimelinePoint[] = [];
  let earned = 0;
  for (let i = 0; i < chart.notes.length; i++) {
    const note = chart.notes[i];
    if (!note) continue;
    const judgement = engine.noteView(i).judgement ?? 'miss';
    earned += earnedFor(judgement);
    out.push({ t: note.t, judgement, accuracy: earned / (i + 1) });
  }
  return out;
}
