import { describe, expect, it } from 'vitest';
import * as core from '../../src/core/index.ts';
import { chart, note } from './helpers.ts';

describe('src/core/index', () => {
  it('exposes the factory surface other modules import', () => {
    expect(typeof core.createEngine).toBe('function');
    expect(typeof core.windowsFromOD).toBe('function');
    expect(typeof core.defaultConfig).toBe('function');
    expect(typeof core.replay).toBe('function');
    expect(typeof core.canonicalChartBody).toBe('function');
    expect(typeof core.chartHash).toBe('function');
    expect(core.DEFAULT_BIG_WINDOW_MS).toBe(30);
  });

  it('re-exports the key helpers from types.ts', () => {
    expect(core.KEYS).toEqual(['KL', 'KR', 'DL', 'DR']);
    expect(core.keyKind('KL')).toBe('k');
    expect(core.keyKind('DR')).toBe('d');
    expect(core.keyHand('KL')).toBe('L');
    expect(core.keyHand('DR')).toBe('R');
    expect(core.partnerKey('KL')).toBe('KR');
    expect(core.partnerKey('DR')).toBe('DL');
  });

  it('wires the pieces together end to end', async () => {
    const c = chart({ notes: [note(1000), note(2000, 'k', true)] });
    const config = core.defaultConfig(c.meta.od);
    const engine = core.createEngine(c, config);
    engine.hit('DL', 1000);
    engine.hit('KR', 2000);
    engine.hit('KL', 2010);
    engine.tick(3000);
    expect(engine.state.score).toBe(1_000_000);
    expect(engine.state.finished).toBe(true);
    expect(core.replay(c, config, engine.log)).toStrictEqual(engine.state);
    expect(await core.chartHash(c)).toMatch(/^[0-9a-f]{64}$/);
  });
});
