import { describe, expect, it } from 'vitest';
import { DEFAULT_BIG_WINDOW_MS, JUDGE_WINDOWS, defaultConfig, windowsFromOD } from '../../src/core/windows.ts';

describe('judgement windows', () => {
  it('are fixed: Great ±30, OK ±50, nothing consumed beyond ±50', () => {
    expect(JUDGE_WINDOWS).toEqual({ great: 30, ok: 50, miss: 50 });
    expect(windowsFromOD()).toEqual({ great: 30, ok: 50, miss: 50 });
  });

  it('ignore the chart OD', () => {
    expect(windowsFromOD(0)).toEqual(windowsFromOD(10));
    expect(windowsFromOD(Number.NaN)).toEqual(JUDGE_WINDOWS);
  });

  it('return a fresh object each call', () => {
    const a = windowsFromOD();
    const b = windowsFromOD();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a).not.toBe(JUDGE_WINDOWS);
  });
});

describe('defaultConfig', () => {
  it('uses the fixed windows and a 30 ms partner window', () => {
    expect(defaultConfig()).toEqual({ windows: JUDGE_WINDOWS, bigWindowMs: 30 });
    expect(defaultConfig(7)).toEqual(defaultConfig());
    expect(DEFAULT_BIG_WINDOW_MS).toBe(30);
  });
});
