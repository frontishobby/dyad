import { describe, expect, it } from 'vitest';
import {
  JACKET_REF_PX,
  STOPS,
  WRAP_MIN,
  createWheelStepper,
  jacketSize,
  nearestChart,
  place,
  shortest,
  stepIndex,
  stepTier,
  swipeDirection,
  wraps,
} from '../../src/app/carousel.ts';
import type { SongChartRef, Tier } from '../../src/app/types.ts';

function ref(tier: Tier, level = 5): SongChartRef {
  return { tier, name: tier, file: `chart.${tier}.json`, hash: `h-${tier}`, od: 5, bpm: [150, 150], notes: 100, stars: level / 1.6, level };
}

describe('place', () => {
  it('centre slot is full size, stops interpolate outward, sign follows the offset', () => {
    expect(place(0)).toEqual({ x: 0, scale: 1, opacity: 1, z: 40 });
    expect(place(1)).toEqual({ x: STOPS[1]!.x, scale: 0.6, opacity: 1, z: 30 });
    expect(place(-1).x).toBe(-STOPS[1]!.x);
    const half = place(0.5);
    expect(half.x).toBeCloseTo(STOPS[1]!.x / 2, 9);
    expect(half.scale).toBeCloseTo(0.8, 9);
    expect(half.z).toBe(35);
  });

  it('clamps beyond the last stop and scales x by the ratio', () => {
    expect(place(9)).toEqual({ x: STOPS[3]!.x, scale: 0.3, opacity: 0, z: 10 });
    expect(place(1, 0.5).x).toBe(STOPS[1]!.x / 2);
    expect(place(1, 0.5).scale).toBe(0.6);
  });
});

describe('jacketSize', () => {
  it('is 340 px on wide viewports and 60 % of narrow ones', () => {
    expect(jacketSize(1280)).toBe(JACKET_REF_PX);
    expect(jacketSize(900)).toBe(JACKET_REF_PX);
    expect(jacketSize(390)).toBe(234);
    expect(jacketSize(0)).toBe(JACKET_REF_PX);
  });
});

describe('wrapping', () => {
  it('wraps only from WRAP_MIN songs', () => {
    expect(wraps(WRAP_MIN - 1)).toBe(false);
    expect(wraps(WRAP_MIN)).toBe(true);
  });

  it('shortest takes the short way round when wrapping, plain delta otherwise', () => {
    expect(shortest(6, 7)).toBe(-1);
    expect(shortest(-6, 7)).toBe(1);
    expect(shortest(3, 7)).toBe(3);
    expect(shortest(4, 8)).toBe(-4);
    expect(shortest(6, 3)).toBe(6);
  });

  it('stepIndex wraps or clamps', () => {
    expect(stepIndex(6, 1, 7)).toBe(0);
    expect(stepIndex(0, -1, 7)).toBe(6);
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(stepIndex(0, -1, 3)).toBe(0);
    expect(stepIndex(5, 1, 0)).toBe(0);
  });
});

describe('tiers', () => {
  const all = [ref('easy', 3), ref('normal', 5), ref('hard', 8)];

  it('nearestChart keeps the wanted tier when present, else the closest', () => {
    expect(nearestChart(all, 'normal')?.tier).toBe('normal');
    expect(nearestChart([ref('easy'), ref('hard')], 'normal')?.tier).toBe('easy');
    expect(nearestChart([ref('hard')], 'easy')?.tier).toBe('hard');
    expect(nearestChart([], 'hard')).toBeNull();
  });

  it('stepTier moves among available tiers in order, clamped', () => {
    expect(stepTier(all, all[1]!, 1)?.tier).toBe('hard');
    expect(stepTier(all, all[2]!, 1)?.tier).toBe('hard');
    expect(stepTier(all, all[0]!, -1)?.tier).toBe('easy');
    expect(stepTier([ref('hard'), ref('easy')], null, 1)?.tier).toBe('hard');
    expect(stepTier([], null, 1)).toBeNull();
  });
});

describe('gestures', () => {
  it('swipeDirection: a leftward drag past the threshold means next', () => {
    expect(swipeDirection(-60)).toBe(1);
    expect(swipeDirection(60)).toBe(-1);
    expect(swipeDirection(-39)).toBe(0);
    expect(swipeDirection(-10, 5)).toBe(1);
  });

  it('wheel stepper fires one step per threshold and cools down', () => {
    let t = 0;
    const steps: number[] = [];
    const step = createWheelStepper((d) => steps.push(d), { threshold: 40, cooldownMs: 100, now: () => t });
    step(0, 25);
    expect(steps).toEqual([]);
    step(0, 25);
    expect(steps).toEqual([1]);
    // inertia inside the cooldown is ignored
    step(0, 80);
    expect(steps).toEqual([1]);
    t = 150;
    step(-50, 5);
    expect(steps).toEqual([1, -1]);
  });
});
