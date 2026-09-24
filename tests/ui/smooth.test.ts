import { describe, expect, it } from 'vitest';
import { SMOOTH_SNAP_MS, createSmoothClock } from '../../src/ui/play/smooth.ts';

describe('createSmoothClock', () => {
  it('starts on the measured value, then advances by frame time and eases toward the audio clock', () => {
    const clock = createSmoothClock(0.5, 60);
    expect(clock.next(1000, 0)).toBe(1000);
    // A frame later the audio clock has jumped 20 ms (a quantum landed) although only 16 ms passed.
    // Predicted 1016, error +4, half of it applied.
    expect(clock.next(1020, 16)).toBeCloseTo(1018, 9);
    // Next frame the audio clock lags (no quantum yet): predicted 1034, measured 1030 → 1032.
    expect(clock.next(1030, 32)).toBeCloseTo(1032, 9);
  });

  it('absorbs quantum jitter: a clock stepping in 11.6 ms quanta read every 16.7 ms renders at a steady rate', () => {
    const clock = createSmoothClock();
    const quantum = 11.6;
    const frame = 16.7;
    const out: number[] = [];
    for (let i = 0; i < 60; i++) {
      const t = i * frame;
      const measured = Math.floor(t / quantum) * quantum;
      out.push(clock.next(measured, t));
    }
    const deltas = out.slice(21).map((v, i) => v - (out[i + 20] as number));
    const min = Math.min(...deltas);
    const max = Math.max(...deltas);
    // Raw deltas would alternate between 11.6 and 23.2; the smoothed ones stay near the frame time.
    expect(max - min).toBeLessThan(3);
    expect((min + max) / 2).toBeCloseTo(frame, 0);
    // and it does not drift away from the audio clock
    const last = out[out.length - 1] as number;
    expect(Math.abs(last - 59 * frame)).toBeLessThan(quantum + 1);
  });

  it('snaps on a large error and after reset()', () => {
    const clock = createSmoothClock();
    clock.next(0, 0);
    expect(clock.next(SMOOTH_SNAP_MS + 100, 16)).toBe(SMOOTH_SNAP_MS + 100);
    clock.reset();
    expect(clock.next(5000, 1000)).toBe(5000);
    // Paused: the audio clock stands still while frames keep coming; a later frame snaps back to it.
    clock.next(5000, 1016);
    expect(clock.next(5000, 2000)).toBe(5000);
  });

  it('passes non-finite readings through', () => {
    const clock = createSmoothClock();
    expect(clock.next(Number.NaN, 0)).toBeNaN();
  });
});
