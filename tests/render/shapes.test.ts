import { describe, expect, it } from 'vitest';
import { SHAPE } from '../../src/design/tokens.ts';
import {
  bigDiameter,
  brickContext,
  buildNoteContexts,
  burstContext,
  circleContext,
  cornerRadius,
  destroyNoteContexts,
  halfCircleContext,
  noteDiameter,
  ringContext,
  seamContext,
  silhouetteContext,
} from '../../src/render/shapes.ts';

describe('sizes', () => {
  it('regular diameter is a fraction of the lead distance; big is bigCircle × that', () => {
    expect(noteDiameter(1000)).toBeCloseTo(1000 * SHAPE.circle, 9);
    expect(bigDiameter(1000)).toBeCloseTo(1000 * SHAPE.circle * SHAPE.bigCircle, 9);
    // Landscape (lead 1024) and portrait (lead ~725) both land near a 1/4-note spacing at ~170 BPM.
    expect(noteDiameter(1024)).toBeGreaterThan(60);
    expect(noteDiameter(1024)).toBeLessThan(90);
  });

  it('corner radius is the shortest side over 8', () => {
    expect(cornerRadius(80, 20)).toBe(2.5);
    expect(cornerRadius(20, 80)).toBe(2.5);
  });
});

describe('Pixi contexts (headless)', () => {
  it('a disc is centred on the origin with the given diameter', () => {
    const ctx = circleContext(70);
    const b = ctx.bounds;
    expect(b.width).toBeCloseTo(70, 6);
    expect(b.height).toBeCloseTo(70, 6);
    expect(b.minX).toBeCloseTo(-35, 6);
    expect(b.minY).toBeCloseTo(-35, 6);
    ctx.destroy();
  });

  it('half discs tile the big diameter with a 1 px seam at the centre', () => {
    const D = 108;
    const l = halfCircleContext(D, 'L');
    const r = halfCircleContext(D, 'R');
    expect(l.bounds.minX).toBeCloseTo(-D / 2, 1);
    expect(l.bounds.maxX).toBeCloseTo(0, 1);
    expect(r.bounds.minX).toBeCloseTo(0, 1);
    expect(r.bounds.maxX).toBeCloseTo(D / 2, 1);
    expect(l.bounds.minY).toBeCloseTo(-D / 2, 1);
    expect(l.bounds.maxY).toBeCloseTo(D / 2, 1);
    const seam = seamContext(D, 0x12131f);
    expect(seam.bounds.width).toBeCloseTo(1, 6);
    expect(seam.bounds.height).toBeCloseTo(D, 6);
    for (const c of [l, r, seam]) c.destroy();
  });

  it('rings and bursts are strokes around the diameter, at least 2 px wide', () => {
    const ring = ringContext(100, 4);
    expect(ring.bounds.width).toBeCloseTo(104, 6);
    expect(ring.bounds.minX).toBeCloseTo(-52, 6);
    const burst = burstContext(100, 0.5);
    expect(burst.bounds.width).toBeCloseTo(102, 6);
    ring.destroy();
    burst.destroy();
  });

  it('the note bundle: regular discs of d, big halves of D, all centred', () => {
    const c = buildNoteContexts(70, 108, 0x12131f);
    expect(c.don.bounds.width).toBeCloseTo(70, 6);
    expect(c.kat.bounds.width).toBeCloseTo(70, 6);
    expect(c.don).not.toBe(c.kat); // separate contexts, same shape
    expect(c.bigDonL.bounds.minX).toBeCloseTo(-54, 1);
    expect(c.bigKatR.bounds.maxX).toBeCloseTo(54, 1);
    expect(c.seam.bounds.height).toBeCloseTo(108, 6);
    destroyNoteContexts(c);
  });

  it('silhouettes are centred discs; bricks start at the origin', () => {
    const s = silhouetteContext(64);
    expect(s.bounds.width).toBeCloseTo(64, 6);
    expect(s.bounds.minX).toBeCloseTo(-32, 6);
    const b = brickContext(100, 40, 0xffffff);
    expect(b.bounds.minX).toBeCloseTo(0, 6);
    expect(b.bounds.width).toBeCloseTo(100, 6);
    s.destroy();
    b.destroy();
  });
});
