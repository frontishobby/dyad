import { describe, expect, it } from 'vitest';
import { computeFill, computeFit } from '../../src/ui/play/fit.ts';

describe('computeFit', () => {
  it('never upscales past 1×', () => {
    const fit = computeFit(2560, 1440, 1280, 720);
    expect(fit.scale).toBe(1);
    expect(fit.w).toBe(1280);
    expect(fit.h).toBe(720);
    expect(fit.x).toBe(640);
    expect(fit.y).toBe(360);
  });

  it('letterboxes a phone viewport for portrait', () => {
    const fit = computeFit(390, 844, 720, 1280);
    expect(fit.w).toBe(390);
    expect(fit.h).toBe(Math.floor(1280 * (390 / 720)));
    // Same formula the stage applies to a w×h container: the scaled logical
    // surface never exceeds the box on either axis.
    expect(fit.scale).toBe(Math.min(fit.w / 720, fit.h / 1280));
    expect(720 * fit.scale).toBeLessThanOrEqual(fit.w);
    expect(1280 * fit.scale).toBeLessThanOrEqual(fit.h);
    expect(fit.x).toBe(0);
    expect(fit.y).toBe(Math.floor((844 - fit.h) / 2));
  });

  it('pillarboxes a wide window for landscape', () => {
    const fit = computeFit(1000, 800, 1280, 720);
    expect(fit.w).toBe(1000);
    expect(fit.h).toBe(Math.floor(720 * (1000 / 1280)));
    expect(fit.y).toBeGreaterThan(0);
    expect(fit.x).toBe(0);
  });

  it('returns an empty box for a collapsed viewport', () => {
    expect(computeFit(0, 500, 1280, 720)).toEqual({ w: 0, h: 0, scale: 0, x: 0, y: 0 });
    expect(computeFit(500, Number.NaN, 1280, 720).scale).toBe(0);
  });
});

describe('computeFill (portrait, dynamic resolution)', () => {
  it('fills the viewport and scales by width only', () => {
    const fill = computeFill(390, 844, 720);
    expect(fill).toEqual({ w: 390, h: 844, scale: 390 / 720, x: 0, y: 0 });
  });

  it('may exceed 1× on wide devices (portrait is not capped)', () => {
    expect(computeFill(1024, 1366, 720).scale).toBeCloseTo(1024 / 720, 12);
  });

  it('returns an empty box for a collapsed viewport', () => {
    expect(computeFill(0, 844, 720)).toEqual({ w: 0, h: 0, scale: 0, x: 0, y: 0 });
    expect(computeFill(390, Number.NaN, 720).scale).toBe(0);
  });
});
