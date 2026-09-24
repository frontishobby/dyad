import { describe, expect, it } from 'vitest';
import { createEngine } from '../../src/core/engine.ts';
import { replay } from '../../src/core/replay.ts';
import type { InputLogEntry } from '../../src/core/types.ts';
import { defaultConfig } from '../../src/core/windows.ts';
import { chart, note, roll, spinner } from './helpers.ts';

// An explicit config with a consumed-miss band (ok < miss), so the timings below exercise every path.
const config = { windows: { great: 35, ok: 80, miss: 95 }, bigWindowMs: defaultConfig().bigWindowMs };

describe('replay', () => {
  it('reproduces the final state of a live run, whatever the tick cadence was', () => {
    const c = chart({
      notes: [note(1000), note(1200, 'k'), note(1400, 'd', true), note(1600, 'k'), note(1800)],
      rolls: [roll(2000, 2600)],
      spinners: [spinner(2800, 3400, 3)],
    });
    const live = createEngine(c, config);
    live.tick(0);
    live.tick(500);
    live.hit('DL', 1010); // great
    live.tick(1100);
    live.hit('DL', 1250); // wrong type on note 1 → miss
    live.tick(1300);
    live.tick(1290); // lagging tick
    live.hit('DR', 1390); // big, first hand, great
    live.hit('DL', 1405); // partner → strong
    live.tick(1500);
    live.hit('KL', 1660); // ok
    // note 4 never pressed → missed by a tick
    live.tick(1900);
    live.hit('DL', 2100); // roll
    live.hit('KR', 2300); // roll
    live.tick(2700);
    live.hit('DL', 2900); // spinner d
    live.hit('KL', 2950); // spinner k
    live.hit('KL', 3000); // ignored, same type
    live.hit('DR', 3100); // spinner d → complete
    live.tick(3500);
    live.tick(3600);
    expect(live.state.finished).toBe(true);

    const replayed = replay(c, config, live.log);
    expect(replayed).toStrictEqual(live.state);
    expect(replayed.finished).toBe(true);
    expect(replayed.counts).toEqual({ great: 2, ok: 1, miss: 2 });
    expect(replayed.rollTicks).toBe(2);
    expect(replayed.spinnerTicks).toBe(3);
    expect(replayed.maxCombo).toBe(2);
  });

  it('returns a detached copy of the state', () => {
    const c = chart({ notes: [note(1000)] });
    const a = replay(c, config, [[1000, 'DL']]);
    const b = replay(c, config, [[1000, 'DL']]);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.counts).not.toBe(b.counts);
  });

  it('sorts the log by time without mutating the caller’s array', () => {
    const c = chart({ notes: [note(1000), note(2000, 'k')] });
    const log: InputLogEntry[] = [
      [2000, 'KL'],
      [1000, 'DL'],
    ];
    const snapshot = log.map((e) => [...e]);
    const state = replay(c, config, log);
    expect(state.counts).toEqual({ great: 2, ok: 0, miss: 0 });
    expect(log.map((e) => [...e])).toEqual(snapshot);
  });

  it('keeps the recorded order for presses with equal timestamps (stable sort)', () => {
    // Note 1 is a don. KL first (wrong type → miss), then DL (nothing left to hit).
    // An unstable sort could swap them and turn this into a great.
    const c = chart({ notes: [note(500), note(1000)] });
    const log: InputLogEntry[] = [
      [1000, 'KL'],
      [500, 'DL'],
      [1000, 'DL'],
    ];
    const state = replay(c, config, log);
    expect(state.counts).toEqual({ great: 1, ok: 0, miss: 1 });

    const reversed: InputLogEntry[] = [
      [1000, 'DL'],
      [500, 'DL'],
      [1000, 'KL'],
    ];
    expect(replay(c, config, reversed).counts).toEqual({ great: 2, ok: 0, miss: 0 });
  });

  it('misses every note when the log is empty and still finishes', () => {
    const c = chart({ notes: [note(1000), note(2000, 'k', true)], rolls: [roll(3000, 4000)] });
    const state = replay(c, config, []);
    expect(state.finished).toBe(true);
    expect(state.counts).toEqual({ great: 0, ok: 0, miss: 2 });
    expect(state.judged).toBe(2);
    expect(state.score).toBe(0);
    expect(state.accuracy).toBe(0);
    expect(state.combo).toBe(0);
    expect(state.maxCombo).toBe(0);
  });

  it('settles notes, rolls and spinners that end after the last press', () => {
    const c = chart({
      notes: [note(1000), note(5000)],
      rolls: [roll(6000, 9000)],
      spinners: [spinner(10_000, 12_000, 2)],
    });
    const state = replay(c, config, [[1000, 'DL']]);
    expect(state.finished).toBe(true);
    expect(state.judged).toBe(2);
    expect(state.counts.miss).toBe(1);
  });

  it('works on a chart with nothing in it', () => {
    const state = replay(chart(), config, []);
    expect(state.finished).toBe(true);
    expect(state.score).toBe(0);
    expect(state.accuracy).toBe(1);
    expect(state.total).toBe(0);
  });

  it('applies the given config (the partner window changes the outcome)', () => {
    const c = chart({ notes: [note(1000, 'd', true)] });
    const both: InputLogEntry[] = [[1000, 'DL'], [1020, 'DR']];
    expect(replay(c, defaultConfig(5), both).score).toBe(1_000_000);
    const narrow = { ...defaultConfig(5), bigWindowMs: 10 };
    expect(replay(c, narrow, both).score).toBe(500_000);
    expect(replay(c, narrow, both).counts.ok).toBe(1);
    const single: InputLogEntry[] = [[1000, 'DL']];
    expect(replay(c, defaultConfig(5), single).counts).toEqual({ great: 0, ok: 1, miss: 0 });
  });
});
