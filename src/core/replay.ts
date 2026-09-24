/**
 * Replay (PLAN §7, §12): the final state is a pure function of
 * (chart, config, input log). Feeds the log through the same engine that
 * judged the live play, then ticks past everything so every note is settled,
 * every spinner has ended and `finished` is set.
 */
import { createEngine } from './engine.ts';
import type { Chart, EngineConfig, EngineState, InputLogEntry } from './types.ts';

export function replay(chart: Chart, config: EngineConfig, log: readonly InputLogEntry[]): EngineState {
  const engine = createEngine(chart, config);

  // Array.prototype.sort is stable (ES2019+), so presses that share a
  // timestamp keep their recorded order. The caller's log is not mutated.
  const presses = log.slice().sort((a, b) => a[0] - b[0]);

  let last = 0;
  for (const [t, key] of presses) {
    engine.hit(key, t);
    if (t > last) last = t;
  }
  for (const note of chart.notes) if (note.t > last) last = note.t;
  for (const roll of chart.rolls) if (roll.end > last) last = roll.end;
  for (const spinner of chart.spinners) if (spinner.end > last) last = spinner.end;

  // Past the widest window that could still be open at `last`.
  engine.tick(last + config.windows.miss + config.bigWindowMs + 1);

  const s = engine.state;
  return { ...s, counts: { ...s.counts } };
}
