import { describe, expect, it } from 'vitest';
import {
  ACCENT,
  CLICK,
  LATE_BEAT_TOLERANCE_S,
  beatLengthMs,
  beatPhaseMs,
  clickSamples,
  contextTimeFromPair,
  contextTimeFromTimeStamp,
  createMetronome,
  eventContextTime,
  median,
  nearestBeatMs,
  type MetronomeSink,
  type MetronomeTimers,
} from '../../src/ui/play/metronome.ts';

describe('median', () => {
  it('is NaN for an empty sample', () => {
    expect(median([])).toBeNaN();
    expect(median([Number.NaN])).toBeNaN();
  });

  it('takes the middle of an odd sample and the mean of the two middles of an even one', () => {
    expect(median([5])).toBe(5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([-20, 15, 12, 300])).toBe(13.5);
  });

  it('resists outliers and leaves the input untouched', () => {
    const taps = [10, 12, 11, 500, 9, 13, -400];
    const copy = [...taps];
    expect(median(taps)).toBe(11);
    expect(taps).toEqual(copy);
  });

  it('ignores non-finite entries', () => {
    expect(median([1, Number.POSITIVE_INFINITY, 3])).toBe(2);
  });
});

describe('beat maths', () => {
  const beatMs = beatLengthMs(100);

  it('100 BPM is a 600 ms beat', () => {
    expect(beatMs).toBe(600);
  });

  it('snaps to the nearest beat, including before beat 0', () => {
    expect(nearestBeatMs(590, beatMs)).toBe(600);
    expect(nearestBeatMs(610, beatMs)).toBe(600);
    expect(nearestBeatMs(299, beatMs)).toBe(0);
    expect(nearestBeatMs(301, beatMs)).toBe(600);
    expect(nearestBeatMs(-40, beatMs)).toBe(0);
    expect(nearestBeatMs(-320, beatMs)).toBe(-600);
  });

  it('phase is always within [0, beat)', () => {
    expect(beatPhaseMs(0, beatMs)).toBe(0);
    expect(beatPhaseMs(1250, beatMs)).toBe(50);
    expect(beatPhaseMs(-10, beatMs)).toBe(590);
  });
});

describe('timestamp conversion', () => {
  it('mirrors the player: contextTime + (timeStamp − performanceTime) / 1000', () => {
    expect(contextTimeFromTimeStamp(10_500, { contextTime: 3.2, performanceTime: 10_000 })).toBeCloseTo(3.7, 9);
    expect(contextTimeFromTimeStamp(9_900, { contextTime: 3.2, performanceTime: 10_000 })).toBeCloseTo(3.1, 9);
  });

  it('rejects unusable samples (missing members, Chrome (0, 0))', () => {
    expect(contextTimeFromTimeStamp(100, {})).toBeNull();
    expect(contextTimeFromTimeStamp(100, { contextTime: 0, performanceTime: 0 })).toBeNull();
    expect(contextTimeFromTimeStamp(100, { contextTime: 1 })).toBeNull();
  });

  it('falls back to the per-frame pair', () => {
    expect(contextTimeFromPair(2_016, { performanceTime: 2_000, contextTime: 7 })).toBeCloseTo(7.016, 9);
    const ctx = {
      getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }),
    } as unknown as AudioContext;
    expect(eventContextTime(ctx, 2_016, { performanceTime: 2_000, contextTime: 7 })).toBeCloseTo(7.016, 9);
    const good = {
      getOutputTimestamp: () => ({ contextTime: 5, performanceTime: 1_000 }),
    } as unknown as AudioContext;
    expect(eventContextTime(good, 1_250, { performanceTime: 0, contextTime: 0 })).toBeCloseTo(5.25, 9);
    const none = {} as AudioContext;
    expect(eventContextTime(none, 1_250, { performanceTime: 1_000, contextTime: 1 })).toBeCloseTo(1.25, 9);
  });
});

describe('createMetronome', () => {
  function harness(bpm = 100) {
    let now = 10;
    const scheduled: { when: number; index: number }[] = [];
    const sink: MetronomeSink = {
      now: () => now,
      schedule: (when, index) => scheduled.push({ when, index }),
    };
    const intervals: { fn: () => void; ms: number }[] = [];
    let cleared = 0;
    const timers: MetronomeTimers = {
      set: (fn, ms) => {
        intervals.push({ fn, ms });
        return intervals.length;
      },
      clear: () => {
        cleared++;
      },
    };
    const m = createMetronome({ sink, bpm, timers, lookaheadS: 0.15, intervalMs: 25, startLeadS: 0.1 });
    return {
      m,
      scheduled,
      intervals,
      advance: (s: number) => {
        now += s;
      },
      cleared: () => cleared,
    };
  }

  it('anchors beat 0 a lead ahead of now and schedules only within the look-ahead', () => {
    const h = harness();
    h.m.start();
    expect(h.m.running).toBe(true);
    expect(h.m.startTime).toBeCloseTo(10.1, 9);
    // First pass at now=10: horizon 10.15 → only beat 0 (10.1). Beat 1 is at 10.7.
    expect(h.scheduled).toEqual([{ when: 10.1, index: 0 }]);
    expect(h.intervals).toHaveLength(1);
    expect(h.intervals[0]?.ms).toBe(25);
  });

  it('schedules each beat exactly once, in order, as the clock advances', () => {
    const h = harness();
    h.m.start();
    for (let i = 0; i < 100; i++) {
      h.advance(0.025);
      h.m.tick();
    }
    // now = 12.5, horizon 12.65 → beats at 10.1, 10.7, 11.3, 11.9, 12.5 (index 0..4)
    expect(h.scheduled.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    for (let i = 0; i < h.scheduled.length; i++) {
      expect(h.scheduled[i]?.when).toBeCloseTo(h.m.beatTime(i), 9);
    }
    expect(h.m.nextBeat).toBe(5);
  });

  it('drops beats it only reached after they passed instead of playing them late', () => {
    const h = harness();
    h.m.start();
    // Tab throttled: the scheduler wakes 3 s later.
    h.advance(3);
    h.m.tick();
    const late = h.scheduled.filter((s) => s.when < 13 - LATE_BEAT_TOLERANCE_S);
    expect(late).toHaveLength(1); // only beat 0, scheduled before the gap
    expect(late[0]?.index).toBe(0);
    // Everything else scheduled in that pass is at or after now.
    for (const s of h.scheduled.slice(1)) expect(s.when).toBeGreaterThanOrEqual(13 - LATE_BEAT_TOLERANCE_S);
    // nextBeat moved past all the skipped beats.
    expect(h.m.beatTime(h.m.nextBeat)).toBeGreaterThanOrEqual(13.15);
  });

  it('converts audio-clock time to metronome ms from beat 0', () => {
    const h = harness();
    h.m.start();
    expect(h.m.msAt(10.1)).toBeCloseTo(0, 9);
    expect(h.m.msAt(10.7)).toBeCloseTo(600, 9);
    expect(h.m.msAt(10.0)).toBeCloseTo(-100, 9);
  });

  it('stop clears the interval and stops scheduling; start is idempotent', () => {
    const h = harness();
    h.m.start();
    h.m.start();
    expect(h.intervals).toHaveLength(1);
    h.m.stop();
    expect(h.cleared()).toBe(1);
    expect(h.m.running).toBe(false);
    const before = h.scheduled.length;
    h.advance(1);
    h.m.tick();
    expect(h.scheduled.length).toBe(before);
    h.m.stop();
    expect(h.cleared()).toBe(1);
  });
});

describe('clickSamples', () => {
  it('is deterministic, the right length, and ends silent', () => {
    const a = clickSamples(48_000, CLICK);
    const b = clickSamples(48_000, CLICK);
    expect(a).toEqual(b);
    expect(a.length).toBe(Math.round((48_000 * CLICK.durationMs) / 1000));
    expect(Math.abs(a[a.length - 1] ?? 1)).toBeLessThan(1e-6);
    let peak = 0;
    for (const v of a) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(CLICK.level);
    expect(peak).toBeGreaterThan(CLICK.level * 0.5);
  });

  it('the accent differs from the click', () => {
    expect(clickSamples(44_100, ACCENT)).not.toEqual(clickSamples(44_100, CLICK));
  });
});
