import { describe, expect, it } from 'vitest';
import { SHAPE } from '../../src/design/tokens.ts';
import {
  bigDonHalfContext,
  bigKatHalfContext,
  brickPoints,
  chevronPoints,
  cornerRadius,
  donContext,
  halfCornerRadii,
  katContext,
  mPoints,
  noteWidth,
  seamContext,
  silhouetteContext,
  translatePoints,
} from '../../src/render/shapes.ts';

const W = 600;
const N = 50;

describe('brickPoints', () => {
  it('is a centred rectangle, clockwise from top-left', () => {
    expect(brickPoints(360, 50)).toEqual([
      { x: -180, y: -25 },
      { x: 180, y: -25 },
      { x: 180, y: 25 },
      { x: -180, y: 25 },
    ]);
  });
});

describe('chevronPoints', () => {
  const w = noteWidth(W); // 360
  const pts = chevronPoints(w, N);

  it('has six points and defaults the peak to N × SHAPE.katPeak', () => {
    expect(pts).toHaveLength(6);
    expect(pts[1]).toEqual({ x: 0, y: -N / 2 - N * SHAPE.katPeak });
  });

  it('rises toward the spawn side (negative local y)', () => {
    const apex = pts[1]!;
    const innerApex = pts[4]!;
    expect(apex.y).toBeLessThan(pts[0]!.y);
    expect(apex.y).toBeLessThan(pts[2]!.y);
    expect(innerApex.y).toBeLessThan(pts[3]!.y);
    expect(innerApex.y).toBeLessThan(pts[5]!.y);
  });

  it('keeps a constant thickness N along the progress axis', () => {
    // Left end, apex, right end: inner minus outer is N everywhere.
    expect(pts[5]!.y - pts[0]!.y).toBe(N);
    expect(pts[4]!.y - pts[1]!.y).toBe(N);
    expect(pts[3]!.y - pts[2]!.y).toBe(N);
  });

  it('spans exactly the requested width, symmetric about x = 0', () => {
    const xs = pts.map((p) => p.x);
    expect(Math.min(...xs)).toBe(-w / 2);
    expect(Math.max(...xs)).toBe(w / 2);
    for (const p of pts) {
      const mirror = pts.find((q) => q.x === -p.x && q.y === p.y);
      expect(mirror).toBeDefined();
    }
  });

  it('honours an explicit peak (DESIGN §8 leaves 1.5N open)', () => {
    const tall = chevronPoints(w, N, N * 1.5);
    expect(tall[1]!.y).toBe(-N / 2 - N * 1.5);
    expect(tall[4]!.y).toBe(N / 2 - N * 1.5);
  });

  it('is clockwise in screen space (positive signed area with y down)', () => {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      area += a.x * b.y - b.x * a.y;
    }
    expect(area).toBeGreaterThan(0);
  });
});

describe('mPoints', () => {
  const pts = mPoints(W, N);

  it('has ten points spanning the full W', () => {
    expect(pts).toHaveLength(10);
    const xs = pts.map((p) => p.x);
    expect(Math.min(...xs)).toBe(-W / 2);
    expect(Math.max(...xs)).toBe(W / 2);
  });

  it('has two apexes at ±W/4 rising toward spawn and a valley on the seam', () => {
    expect(pts[1]).toEqual({ x: -W / 4, y: -N / 2 - N });
    expect(pts[3]).toEqual({ x: W / 4, y: -N / 2 - N });
    expect(pts[2]).toEqual({ x: 0, y: -N / 2 });
    expect(pts[7]).toEqual({ x: 0, y: N / 2 });
  });

  it('is the union outline of two W/2 chevrons shifted to ±W/4', () => {
    const left = translatePoints(chevronPoints(W / 2, N), -W / 4, 0);
    const right = translatePoints(chevronPoints(W / 2, N), W / 4, 0);
    // Outer edge: left chevron's outer edge then right chevron's outer edge.
    expect(pts.slice(0, 3)).toEqual(left.slice(0, 3));
    expect(pts.slice(2, 5)).toEqual(right.slice(0, 3));
    // Inner edge: right chevron's inner edge then left chevron's inner edge.
    expect(pts.slice(5, 8)).toEqual(right.slice(3, 6));
    expect(pts.slice(7, 10)).toEqual(left.slice(3, 6));
  });

  it('keeps thickness N', () => {
    expect(pts[9]!.y - pts[0]!.y).toBe(N);
    expect(pts[8]!.y - pts[1]!.y).toBe(N);
    expect(pts[7]!.y - pts[2]!.y).toBe(N);
  });
});

describe('halfCornerRadii / cornerRadius', () => {
  it('radius is the shortest side over 8', () => {
    expect(cornerRadius(360, 50)).toBe(50 / 8);
    expect(cornerRadius(50, 360)).toBe(50 / 8);
    expect(SHAPE.radius).toBe(1 / 8);
  });

  it('squares the corners on the seam (x = 0) and rounds the rest', () => {
    const pts = halfCornerRadii(translatePoints(chevronPoints(W / 2, N), -W / 4, 0), 6);
    const onSeam = pts.filter((p) => p.x === 0);
    expect(onSeam).toHaveLength(2);
    for (const p of onSeam) expect(p.radius).toBe(0);
    for (const p of pts.filter((q) => q.x !== 0)) expect(p.radius).toBe(6);
  });
});

describe('Pixi contexts (headless)', () => {
  it('don brick bounds are 0.6W × N centred on the origin', () => {
    const ctx = donContext(W, N);
    const b = ctx.bounds;
    expect(b.width).toBeCloseTo(noteWidth(W), 6);
    expect(b.height).toBeCloseTo(N, 6);
    expect(b.minX).toBeCloseTo(-noteWidth(W) / 2, 6);
    expect(b.minY).toBeCloseTo(-N / 2, 6);
    ctx.destroy();
  });

  it('kat chevron bounds rise N toward the spawn side', () => {
    const ctx = katContext(W, N);
    const b = ctx.bounds;
    expect(b.width).toBeCloseTo(noteWidth(W), 6);
    // The rounded apex sits a fraction of a px below the sharp apex.
    expect(b.minY).toBeCloseTo(-N / 2 - N, 0);
    // Acute inner corners are pulled up by the corner radius; never below N/2.
    expect(b.maxY).toBeLessThanOrEqual(N / 2 + 1e-6);
    expect(b.maxY).toBeGreaterThan(N / 2 - cornerRadius(noteWidth(W), N) * 2);
    ctx.destroy();
  });

  it('big halves tile the full W with a 1 px seam at the centre', () => {
    const l = bigDonHalfContext(W, N, 'L');
    const r = bigDonHalfContext(W, N, 'R');
    expect(l.bounds.minX).toBeCloseTo(-W / 2, 6);
    expect(l.bounds.maxX).toBeCloseTo(0, 6);
    expect(r.bounds.minX).toBeCloseTo(0, 6);
    expect(r.bounds.maxX).toBeCloseTo(W / 2, 6);
    const kl = bigKatHalfContext(W, N, 'L');
    const kr = bigKatHalfContext(W, N, 'R');
    expect(kl.bounds.minX).toBeCloseTo(-W / 2, 6);
    expect(kl.bounds.maxX).toBeCloseTo(0, 6);
    expect(kr.bounds.maxX).toBeCloseTo(W / 2, 6);
    expect(kl.bounds.minY).toBeCloseTo(-N / 2 - N, 0);
    const seam = seamContext(N, 0x12131f);
    expect(seam.bounds.width).toBeCloseTo(1, 6);
    expect(seam.bounds.height).toBeCloseTo(N, 6);
    for (const c of [l, r, kl, kr, seam]) c.destroy();
  });

  it('silhouettes are centred miniatures', () => {
    const d = silhouetteContext('d', 64, 0x6c6e8a);
    expect(d.bounds.width).toBeCloseTo(64, 6);
    expect(d.bounds.height).toBeCloseTo(16, 6);
    expect(d.bounds.minX).toBeCloseTo(-32, 6);
    const k = silhouetteContext('k', 64, 0x6c6e8a);
    expect(k.bounds.width).toBeCloseTo(64, 6);
    expect(k.bounds.minY).toBeLessThan(d.bounds.minY);
    d.destroy();
    k.destroy();
  });
});
