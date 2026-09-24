import { describe, expect, it } from 'vitest';
import type { EngineState, InputLogEntry, PlayResult } from '../../src/core/types.ts';
import { buildPlayResult, isNewBest } from '../../src/ui/play/result.ts';

const state: EngineState = {
  score: 912_345,
  accuracy: 0.9123,
  combo: 12,
  maxCombo: 180,
  counts: { great: 300, ok: 40, miss: 6 },
  rollTicks: 22,
  spinnerTicks: 9,
  judged: 346,
  total: 346,
  finished: true,
};

const log: InputLogEntry[] = [
  [1000, 'DL'],
  [1400, 'KR'],
  [1800, 'DR'],
];

describe('buildPlayResult', () => {
  it('assembles a PlayResult from the final engine state', () => {
    const result = buildPlayResult({
      chartHash: 'abc',
      songId: 'twin-pulse',
      state,
      log,
      offsets: { audio: 12, input: -8 },
      createdAt: 1_700_000_000_000,
    });
    expect(result).toEqual({
      chartHash: 'abc',
      songId: 'twin-pulse',
      score: 912_345,
      accuracy: 0.9123,
      maxCombo: 180,
      counts: { great: 300, ok: 40, miss: 6 },
      rollTicks: 22,
      spinnerTicks: 9,
      offsets: { audio: 12, input: -8 },
      replay: [
        [1000, 'DL'],
        [1400, 'KR'],
        [1800, 'DR'],
      ],
      createdAt: 1_700_000_000_000,
    } satisfies PlayResult);
  });

  it('copies counts and the replay so later engine mutation cannot leak in', () => {
    const liveLog: InputLogEntry[] = [[10, 'KL']];
    const liveState: EngineState = { ...state, counts: { great: 1, ok: 0, miss: 0 } };
    const result = buildPlayResult({
      chartHash: 'h',
      songId: 's',
      state: liveState,
      log: liveLog,
      offsets: { audio: 0, input: 0 },
      createdAt: 0,
    });
    liveLog.push([20, 'KR']);
    liveState.counts.great = 99;
    expect(result.replay).toEqual([[10, 'KL']]);
    expect(result.counts.great).toBe(1);
    expect(result.replay).not.toBe(liveLog);
  });

  it('does not reference the current combo (display only)', () => {
    const result = buildPlayResult({
      chartHash: 'h',
      songId: 's',
      state,
      log: [],
      offsets: { audio: 0, input: 0 },
      createdAt: 0,
    });
    expect(result).not.toHaveProperty('combo');
    expect(result).not.toHaveProperty('judged');
  });
});

describe('isNewBest', () => {
  const mk = (score: number): PlayResult =>
    buildPlayResult({
      chartHash: 'h',
      songId: 's',
      state: { ...state, score },
      log: [],
      offsets: { audio: 0, input: 0 },
      createdAt: 0,
    });

  it('is true for a first record and for a strictly higher score', () => {
    expect(isNewBest(mk(100), null)).toBe(true);
    expect(isNewBest(mk(101), mk(100))).toBe(true);
    expect(isNewBest(mk(100), mk(100))).toBe(false);
    expect(isNewBest(mk(99), mk(100))).toBe(false);
  });
});
