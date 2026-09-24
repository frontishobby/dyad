import { describe, expect, it } from 'vitest';
import { createEngine, defaultConfig } from '../../src/core/index.ts';
import type { Chart, EngineEvent, Key } from '../../src/core/types.ts';
import { AUTO_HOLD_MS, buildAutoSchedule, createAutoPilot } from '../../src/ui/play/autopilot.ts';

function chart(): Chart {
  return {
    version: 1,
    meta: { title: 't', artist: 'a', difficulty: 'x', bpm: [150, 150], od: 5, hp: 5 },
    timing: [{ t: 0, beatLength: 400, meter: 4 }],
    notes: [
      { t: 1000, k: 'd', big: false },
      { t: 1400, k: 'k', big: false },
      { t: 1800, k: 'd', big: true },
      { t: 2200, k: 'd', big: false },
    ],
    rolls: [{ t: 3000, end: 3800, big: false }], // 4 eighths at 400 ms beats
    spinners: [{ t: 5000, end: 6000, hits: 3 }],
    hash: 'h'.repeat(64),
  };
}

describe('buildAutoSchedule', () => {
  it('presses each note with alternating hands, both hands for a big one, rolls per eighth, spinners alternating types', () => {
    const s = buildAutoSchedule(chart());
    expect(s).toEqual([
      { t: 1000, key: 'DL' },
      { t: 1400, key: 'KL' },
      { t: 1800, key: 'DL' },
      { t: 1800, key: 'DR' },
      { t: 2200, key: 'DR' }, // the second regular don goes to the other hand
      { t: 3000, key: 'DL' },
      { t: 3200, key: 'DR' },
      { t: 3400, key: 'DL' },
      { t: 3600, key: 'DR' },
      { t: 5000, key: 'DL' },
      { t: 5080, key: 'KL' },
      { t: 5160, key: 'DL' },
    ]);
  });
});

describe('createAutoPilot', () => {
  it('drives the engine to a perfect play: all Great, every roll tick and spinner hit, full score', () => {
    const c = chart();
    const engine = createEngine(c, defaultConfig());
    const pressed: [Key, boolean][] = [];
    const applied: EngineEvent[] = [];
    const pilot = createAutoPilot(buildAutoSchedule(c), {
      engine,
      renderer: { press: (k, d) => pressed.push([k, d]), apply: (e) => applied.push(...e) },
      hitSounds: { play() {} },
      hud: { noteEvents() {} },
    });
    for (let ms = 0; ms <= 7000; ms += 16) {
      pilot.poll(ms);
      engine.tick(ms);
    }
    expect(pilot.remaining).toBe(0);
    expect(engine.state.counts).toEqual({ great: 4, ok: 0, miss: 0 });
    expect(engine.state.rollTicks).toBe(4);
    expect(engine.state.spinnerTicks).toBe(3);
    expect(engine.state.score).toBe(1_000_000);
    expect(engine.state.finished).toBe(true);
    // Keys are shown held and released a little later.
    expect(pressed[0]).toEqual(['DL', true]);
    const release = pressed.findIndex(([k, d]) => k === 'DL' && !d);
    expect(release).toBeGreaterThan(0);
    expect(AUTO_HOLD_MS).toBeGreaterThan(0);
  });
});
