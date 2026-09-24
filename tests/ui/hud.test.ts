import { describe, expect, it } from 'vitest';
import type { EngineEvent } from '../../src/core/types.ts';
import type { Layout } from '../../src/render/types.ts';
import {
  FIGURE_SPACE,
  PUNCTUATION_SPACE,
  crossedMilestone,
  formatScore,
  judgementAnchor,
  judgementTone,
  judgementWord,
  latestJudgement,
  progressRatio,
} from '../../src/ui/play/hud.ts';

const F = FIGURE_SPACE;
const P = PUNCTUATION_SPACE;

describe('formatScore', () => {
  it('pads to the 7-digit, 2-comma shape with figure and punctuation spaces', () => {
    expect(formatScore(987_650)).toBe(`${F}${P}987,650`);
    expect(formatScore(1_000_000)).toBe('1,000,000');
    expect(formatScore(50)).toBe(`${F}${P}${F}${F}${F}${P}${F}50`);
    expect(formatScore(0)).toBe(`${F}${P}${F}${F}${F}${P}${F}${F}0`);
  });

  it('always yields the same number of glyph slots', () => {
    const widths = new Set([0, 7, 999, 1_000, 12_345, 999_999, 1_000_000].map((s) => formatScore(s).length));
    expect(widths).toEqual(new Set([9]));
  });

  it('clamps and rounds', () => {
    expect(formatScore(-5)).toBe(formatScore(0));
    expect(formatScore(12_345.6)).toBe(`${F}${P}${F}12,346`);
    expect(formatScore(Number.NaN)).toBe(formatScore(0));
    expect(formatScore(99_999_999)).toBe('9,999,999');
  });
});

describe('crossedMilestone', () => {
  it('fires when the combo grows across a multiple of 50', () => {
    expect(crossedMilestone(49, 50)).toBe(true);
    expect(crossedMilestone(49, 51)).toBe(true);
    expect(crossedMilestone(0, 100)).toBe(true);
    expect(crossedMilestone(99, 100)).toBe(true);
  });

  it('stays quiet otherwise', () => {
    expect(crossedMilestone(0, 1)).toBe(false);
    expect(crossedMilestone(50, 51)).toBe(false);
    expect(crossedMilestone(50, 50)).toBe(false);
    expect(crossedMilestone(120, 0)).toBe(false);
    expect(crossedMilestone(10, 20, 0)).toBe(false);
  });
});

describe('progressRatio', () => {
  it('clamps to 0..1 and quantises', () => {
    expect(progressRatio(-500, 10_000)).toBe(0);
    expect(progressRatio(5_000, 10_000)).toBe(0.5);
    expect(progressRatio(20_000, 10_000)).toBe(1);
    expect(progressRatio(1, 10_000)).toBe(0);
    expect(progressRatio(6, 10_000)).toBe(0.001);
  });

  it('is 0 without a duration', () => {
    expect(progressRatio(1000, 0)).toBe(0);
    expect(progressRatio(Number.NaN, 1000)).toBe(0);
  });
});

describe('latestJudgement', () => {
  const note = (judgement: 'great' | 'ok' | 'miss'): EngineEvent => ({
    type: 'note',
    index: 0,
    judgement,
    deltaMs: 0,
    key: 'DL',
    big: false,
    strong: false,
  });

  it('returns the last note judgement in the batch', () => {
    expect(latestJudgement([note('great'), { type: 'roll-tick', index: 0, key: 'DL' }, note('ok')])).toBe('ok');
  });

  it('ignores batches without note events', () => {
    expect(latestJudgement([])).toBeNull();
    expect(latestJudgement([{ type: 'roll-tick', index: 0, key: 'DR' }])).toBeNull();
  });

  it('maps judgement to tone and word', () => {
    expect(judgementTone('great')).toBe('text');
    expect(judgementTone('ok')).toBe('text-dim');
    expect(judgementTone('miss')).toBe('text-faint');
    expect(judgementWord('great')).toBe('Great');
    expect(judgementWord('ok')).toBe('OK');
    expect(judgementWord('miss')).toBe('Miss');
  });
});

describe('judgementAnchor', () => {
  const base = {
    logical: { w: 720, h: 1280 },
    W: 600,
    N: 50,
    info: { x: 0, y: 0, w: 720, h: 154 },
    leadPx: 500,
  };

  it('sits under the gate in portrait', () => {
    const layout: Layout = {
      ...base,
      orientation: 'portrait',
      track: { x: 60, y: 154, w: 600, h: 600 },
      gate: { x: 60, y: 760, w: 600, h: 106 },
    };
    expect(judgementAnchor(layout)).toEqual({ x: 360, y: 760 + 106 + 16 });
  });

  it('sits under the track, on the gate column, in landscape', () => {
    const layout: Layout = {
      ...base,
      orientation: 'landscape',
      logical: { w: 1280, h: 720 },
      track: { x: 0, y: 144, w: 1280, h: 432 },
      gate: { x: 216, y: 144, w: 78, h: 432 },
    };
    expect(judgementAnchor(layout)).toEqual({ x: 255, y: 144 + 432 + 24 });
  });
});
