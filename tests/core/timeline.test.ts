import { describe, expect, it } from 'vitest';
import { replay } from '../../src/core/replay.ts';
import { earnedFor, judgementTimeline } from '../../src/core/timeline.ts';
import { defaultConfig } from '../../src/core/windows.ts';
import { chart, note } from './helpers.ts';

const config = defaultConfig();

describe('judgementTimeline', () => {
  it('lists every note in chart order with its judgement and the running accuracy', () => {
    const c = chart({ notes: [note(1000), note(1200, 'k'), note(1400), note(1600, 'k')] });
    const log = [
      [1000, 'DL'],
      [1240, 'KL'], // ok
      // 1400 never pressed
      [1600, 'KR'],
    ] as const;
    const points = judgementTimeline(c, config, log);
    expect(points.map((p) => p.t)).toEqual([1000, 1200, 1400, 1600]);
    expect(points.map((p) => p.judgement)).toEqual(['great', 'ok', 'miss', 'great']);
    expect(points.map((p) => p.accuracy)).toEqual([1, 0.75, 0.5, 0.625]);
  });

  it('ends on the same accuracy and counts as replay()', () => {
    const c = chart({ notes: [note(1000), note(1200, 'k'), note(1400, 'd', true), note(1600, 'k')] });
    const log = [
      [1005, 'DL'],
      [1230, 'KR'],
      [1400, 'DL'],
      [1410, 'DR'],
    ] as const;
    const points = judgementTimeline(c, config, log);
    const state = replay(c, config, log);
    expect(points[points.length - 1]?.accuracy).toBeCloseTo(state.accuracy, 12);
    const counts = { great: 0, ok: 0, miss: 0 };
    for (const p of points) counts[p.judgement]++;
    expect(counts).toEqual(state.counts);
  });

  it('is empty for a chart without notes and weighs great 1, ok 0.5, miss 0', () => {
    expect(judgementTimeline(chart({ notes: [] }), config, [])).toEqual([]);
    expect([earnedFor('great'), earnedFor('ok'), earnedFor('miss')]).toEqual([1, 0.5, 0]);
  });
});
