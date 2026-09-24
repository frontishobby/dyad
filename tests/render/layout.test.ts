import { describe, expect, it } from 'vitest';
import { KEYS, type Key } from '../../src/core/types.ts';
import { LAYOUT, SHAPE } from '../../src/design/tokens.ts';
import {
  computeLayout,
  defaultLeadMs,
  defaultLogical,
  gateCells,
  gateCellsLocal,
  gateGap,
  localFrame,
  localToScreen,
  nearClipPx,
  portraitLogical,
  portraitTouchHeight,
  progressDirection,
  screenToLocal,
  seamPosition,
  touchAreaTop,
  trackNearPx,
  PORTRAIT_SPACING,
} from '../../src/render/layout.ts';
import type { Rect } from '../../src/input/types.ts';

function right(r: Rect): number {
  return r.x + r.w;
}
function bottom(r: Rect): number {
  return r.y + r.h;
}
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

describe('logical sizes', () => {
  it('defaultLogical: landscape 1280×720, portrait 720×1280', () => {
    expect(defaultLogical('landscape')).toEqual({ w: 1280, h: 720 });
    expect(defaultLogical('portrait')).toEqual({ w: 720, h: 1280 });
  });

  it('portraitLogical follows the viewport aspect at width 720, clamped', () => {
    expect(portraitLogical(390, 844)).toEqual({ w: 720, h: Math.round((720 * 844) / 390) });
    expect(portraitLogical(390, 844).h).toBe(1558);
    expect(portraitLogical(720, 1280)).toEqual({ w: 720, h: 1280 });
    // Clamp: a squat viewport gets the minimum, an absurdly tall one the maximum.
    expect(portraitLogical(800, 600).h).toBe(LAYOUT.portrait.minHeight);
    expect(portraitLogical(300, 3000).h).toBe(LAYOUT.portrait.maxHeight);
    // Garbage in → the default.
    expect(portraitLogical(0, 0)).toEqual(defaultLogical('portrait'));
  });

  it('portraitTouchHeight is 30% but never under the minimum', () => {
    expect(portraitTouchHeight(1280)).toBe(384);
    expect(portraitTouchHeight(1558)).toBe(Math.round(1558 * 0.3));
    expect(portraitTouchHeight(1000)).toBe(LAYOUT.portrait.touchMinPx);
  });
});

describe('computeLayout portrait (720×1280)', () => {
  const L = computeLayout('portrait');
  const lw = 720;
  const lh = 1280;

  it('uses the default portrait logical size when none is given', () => {
    expect(L.orientation).toBe('portrait');
    expect(L.logical).toEqual({ w: lw, h: lh });
    expect(computeLayout('portrait', { w: 720, h: 1280 })).toEqual(L);
  });

  it('W = 640 with 40 px gutters, N = W/16 = 40', () => {
    expect(PORTRAIT_SPACING.sideGutter).toBe(LAYOUT.portrait.gutterPx);
    expect(L.W).toBe(640);
    expect(L.N).toBe(40);
    expect(L.track.x).toBe(PORTRAIT_SPACING.sideGutter);
    expect(L.track.w).toBe(640);
  });

  it('info strip is a fixed 112 px', () => {
    expect(L.info).toEqual({ x: 0, y: 0, w: lw, h: LAYOUT.portrait.infoPx });
    expect(L.track.y).toBe(L.info.h);
  });

  it('touch zones fill the bottom 30% (384 px) as a 2×2 grid, KL/KR over DL/DR', () => {
    const tz = L.touchZones;
    expect(tz).toBeDefined();
    if (!tz) return;
    const touchTop = lh - 384;
    const { touchGap, sideGutter } = PORTRAIT_SPACING;
    expect(touchAreaTop(L)).toBe(touchTop);

    expect(tz.KL.x).toBe(sideGutter);
    expect(tz.DL.x).toBe(sideGutter);
    expect(tz.KR.x).toBe(tz.KL.x + tz.KL.w + touchGap);
    expect(tz.DR.x).toBe(tz.KR.x);
    expect(right(tz.KR)).toBe(sideGutter + L.W);

    expect(tz.KL.y).toBe(touchTop + touchGap);
    expect(tz.KR.y).toBe(tz.KL.y);
    expect(tz.DL.y).toBe(tz.KL.y + tz.KL.h + touchGap);
    expect(tz.DR.y).toBe(tz.DL.y);
    expect(bottom(tz.DL)).toBe(lh - touchGap);

    for (const key of KEYS) {
      expect(tz[key].w).toBe(tz.KL.w);
      expect(tz[key].h).toBe(tz.KL.h);
    }
    expect(tz.KL.w).toBe((L.W - touchGap) / 2);
    expect(tz.KL.h).toBeGreaterThan(150);

    const keys = KEYS as readonly Key[];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        expect(overlaps(tz[keys[i] as Key], tz[keys[j] as Key])).toBe(false);
      }
    }
  });

  it('gate sits 16 px above the touch area, two rows of N with an N/8 gap, seam in the middle', () => {
    const touchTop = lh - 384;
    const gap = gateGap(L);
    expect(gap).toBe(L.N * SHAPE.gateGap);
    expect(L.gate.x).toBe(L.track.x);
    expect(L.gate.w).toBe(L.W);
    expect(L.gate.h).toBeCloseTo(L.N * 2 + gap, 9);
    expect(bottom(L.gate)).toBe(touchTop - PORTRAIT_SPACING.gateClearance);

    const seam = seamPosition(L);
    expect(seam).toBeCloseTo(L.gate.y + L.N + gap / 2, 9);
    expect(seam).toBeCloseTo(837.5, 9);
  });

  it('gate cells: kat row far (top), don row near (bottom), left column = left hand', () => {
    const cells = gateCells(L);
    const gap = gateGap(L);
    expect(cells.KL.y).toBe(L.gate.y);
    expect(cells.KR.y).toBe(L.gate.y);
    expect(cells.DL.y).toBeCloseTo(L.gate.y + L.N + gap, 9);
    expect(cells.DR.y).toBeCloseTo(cells.DL.y, 9);
    expect(cells.KL.x).toBe(L.gate.x);
    expect(cells.KR.x).toBeGreaterThan(cells.KL.x);
    expect(right(cells.KR)).toBeCloseTo(right(L.gate), 9);
    for (const key of KEYS) {
      expect(cells[key].h).toBeCloseTo(L.N, 9);
      expect(cells[key].w).toBeCloseTo((L.W - gap) / 2, 9);
    }
    const seam = seamPosition(L);
    expect(seam).toBeGreaterThan(bottom(cells.KL));
    expect(seam).toBeLessThan(cells.DL.y);
  });

  it('track spans info bottom → kat row top; leadPx = seam − track top', () => {
    expect(bottom(L.track)).toBeCloseTo(L.gate.y, 9);
    expect(L.leadPx).toBeCloseTo(seamPosition(L) - L.track.y, 9);
    expect(L.leadPx).toBeCloseTo(725.5, 9);
    expect(trackNearPx(L)).toBeCloseTo(L.N + gateGap(L) / 2, 9);
    expect(nearClipPx(L)).toBeCloseTo(seamPosition(L) - touchAreaTop(L), 9);
    expect(nearClipPx(L)).toBeLessThan(0);
  });

  it('nothing overlaps: info / track / gate / touch zones are stacked top to bottom', () => {
    const tz = L.touchZones;
    expect(bottom(L.info)).toBeLessThanOrEqual(L.track.y);
    expect(bottom(L.track)).toBeLessThanOrEqual(L.gate.y);
    if (tz) expect(bottom(L.gate)).toBeLessThan(tz.KL.y);
  });

  it('local → screen: notes fall down; u runs left → right', () => {
    const seam = seamPosition(L);
    expect(progressDirection(L)).toEqual({ x: 0, y: -1 });
    expect(localToScreen(L, 0, 0)).toEqual({ x: L.track.x, y: seam });
    expect(localToScreen(L, 0, 1)).toEqual({ x: L.track.x + L.W, y: seam });
    expect(localToScreen(L, L.leadPx, 0.5)).toEqual({ x: L.track.x + L.W / 2, y: L.track.y });
    expect(localToScreen(L, -10, 0.5).y).toBeGreaterThan(seam);
    const a = localToScreen(L, 100, 0.5);
    const b = localToScreen(L, 100 + L.N, 0.5);
    expect(b.y).toBeLessThan(a.y);
    expect(b.x).toBe(a.x);
  });

  it('localFrame is a pure translation and agrees with localToScreen', () => {
    const f = localFrame(L);
    expect(f.rotation).toBe(0);
    for (const [p, u] of [[0, 0], [120, 0.25], [-40, 1]] as const) {
      const s = localToScreen(L, p, u);
      expect(f.x + u * L.W).toBeCloseTo(s.x, 9);
      expect(f.y - p).toBeCloseTo(s.y, 9);
    }
  });

  it('screenToLocal inverts localToScreen', () => {
    const s = localToScreen(L, 77, 0.3);
    const l = screenToLocal(L, s.x, s.y);
    expect(l.p).toBeCloseTo(77, 9);
    expect(l.u).toBeCloseTo(0.3, 9);
  });

  it('gate cells map from local cells through localToScreen', () => {
    const local = gateCellsLocal(L);
    const screen = gateCells(L);
    for (const key of KEYS) {
      const c = local[key];
      const tl = localToScreen(L, -c.y, c.x / L.W);
      expect(tl.x).toBeCloseTo(screen[key].x, 9);
      expect(tl.y).toBeCloseTo(screen[key].y, 9);
    }
    expect(local.KL.y + local.KL.h).toBeLessThan(0);
    expect(local.DL.y).toBeGreaterThan(0);
  });
});

describe('computeLayout portrait (dynamic height, 720×1558 = a 390×844 phone)', () => {
  const L = computeLayout('portrait', portraitLogical(390, 844));
  const S = computeLayout('portrait');

  it('keeps W, N and the info strip; the extra height goes to the track and the touch area', () => {
    expect(L.logical).toEqual({ w: 720, h: 1558 });
    expect(L.W).toBe(S.W);
    expect(L.N).toBe(S.N);
    expect(L.info).toEqual(S.info);
    expect(L.touchZones?.KL.h).toBeGreaterThan(S.touchZones?.KL.h ?? Infinity);
    expect(L.track.h).toBeGreaterThan(S.track.h);
    expect(L.leadPx).toBeGreaterThan(S.leadPx);
    expect(touchAreaTop(L)).toBe(1558 - Math.round(1558 * 0.3));
    expect(bottom(L.touchZones?.DL ?? { x: 0, y: 0, w: 0, h: 0 })).toBe(1558 - PORTRAIT_SPACING.touchGap);
  });

  it('a short logical height still keeps the minimum touch area', () => {
    const M = computeLayout('portrait', { w: 720, h: LAYOUT.portrait.minHeight });
    expect(touchAreaTop(M)).toBe(LAYOUT.portrait.minHeight - LAYOUT.portrait.touchMinPx);
    expect(M.track.h).toBeGreaterThan(200);
  });
});

describe('computeLayout landscape', () => {
  const L = computeLayout('landscape');
  const lw = 1280;
  const lh = 720;

  it('uses the fixed landscape logical size', () => {
    expect(L.orientation).toBe('landscape');
    expect(L.logical).toEqual({ w: lw, h: lh });
    expect(L.touchZones).toBeUndefined();
    expect(computeLayout('landscape', { w: 1280, h: 720 })).toEqual(L);
  });

  it('track band is 320 px, low on the screen (top at 340), full width; W = 320, N = 20', () => {
    expect(L.W).toBe(LAYOUT.landscape.trackHeightPx);
    expect(L.W).toBe(320);
    expect(L.N).toBe(20);
    expect(L.track).toEqual({ x: 0, y: LAYOUT.landscape.trackTopPx, w: lw, h: 320 });
    expect(L.track.y).toBe(340);
    expect(L.info).toEqual({ x: 0, y: 0, w: lw, h: 340 });
    expect(L.track.y + L.track.h).toBeLessThanOrEqual(lh);
  });

  it('seam at x = 0.2 × 1280 = 256; don column near (left), kat column far (right)', () => {
    expect(seamPosition(L)).toBe(256);
    const gap = gateGap(L);
    expect(L.gate.w).toBeCloseTo(L.N * 2 + gap, 9);
    expect(L.gate.h).toBe(L.W);
    expect(L.gate.y).toBe(L.track.y);
    expect(L.gate.x + L.gate.w / 2).toBeCloseTo(256, 9);

    const cells = gateCells(L);
    expect(right(cells.DL)).toBeCloseTo(256 - gap / 2, 9);
    expect(cells.KL.x).toBeCloseTo(256 + gap / 2, 9);
    for (const key of KEYS) {
      expect(cells[key].w).toBeCloseTo(L.N, 9);
      expect(cells[key].h).toBeCloseTo((L.W - gap) / 2, 9);
    }
    expect(cells.KL.y).toBe(L.track.y);
    expect(cells.DL.y).toBe(L.track.y);
    expect(cells.KR.y).toBeGreaterThan(cells.KL.y);
    expect(bottom(cells.KR)).toBeCloseTo(bottom(L.track), 9);
  });

  it('leadPx = 1280 − seam', () => {
    expect(L.leadPx).toBe(1024);
    expect(trackNearPx(L)).toBe(-256);
    expect(nearClipPx(L)).toBe(-256);
  });

  it('local → screen: notes travel right → left; u runs top → bottom', () => {
    expect(progressDirection(L)).toEqual({ x: 1, y: 0 });
    expect(localToScreen(L, 0, 0)).toEqual({ x: 256, y: L.track.y });
    expect(localToScreen(L, 0, 1)).toEqual({ x: 256, y: L.track.y + L.W });
    expect(localToScreen(L, L.leadPx, 0.5)).toEqual({ x: lw, y: L.track.y + L.W / 2 });
    expect(localToScreen(L, -10, 0.5).x).toBeLessThan(256);
    const a = localToScreen(L, 100, 0.5);
    const b = localToScreen(L, 100 + L.N, 0.5);
    expect(b.x).toBeGreaterThan(a.x);
    expect(b.y).toBe(a.y);
  });

  it('localFrame is a +90° rotation that agrees with localToScreen', () => {
    const f = localFrame(L);
    expect(f.rotation).toBeCloseTo(Math.PI / 2, 12);
    const cos = Math.cos(f.rotation);
    const sin = Math.sin(f.rotation);
    for (const [p, u] of [[0, 0], [120, 0.25], [-40, 1], [L.leadPx, 0.5]] as const) {
      const lx = u * L.W;
      const ly = -p;
      const sx = cos * lx - sin * ly + f.x;
      const sy = sin * lx + cos * ly + f.y;
      const s = localToScreen(L, p, u);
      expect(sx).toBeCloseTo(s.x, 9);
      expect(sy).toBeCloseTo(s.y, 9);
    }
  });

  it('screenToLocal inverts localToScreen', () => {
    const s = localToScreen(L, -30, 0.9);
    const l = screenToLocal(L, s.x, s.y);
    expect(l.p).toBeCloseTo(-30, 9);
    expect(l.u).toBeCloseTo(0.9, 9);
  });

  it('gate cells in local coordinates are identical to portrait (one code path)', () => {
    const P = computeLayout('portrait');
    const a = gateCellsLocal(L);
    const b = gateCellsLocal(P);
    for (const key of KEYS) {
      expect(a[key].x / L.W).toBeCloseTo(b[key].x / P.W, 9);
      expect(a[key].y / L.N).toBeCloseTo(b[key].y / P.N, 9);
      expect(a[key].w / L.W).toBeCloseTo(b[key].w / P.W, 9);
      expect(a[key].h / L.N).toBeCloseTo(b[key].h / P.N, 9);
    }
  });
});

describe('note sizes (DESIGN §2 after the first playtest)', () => {
  it('regular notes are 0.5W wide and W/16 thick', () => {
    const L = computeLayout('landscape');
    expect(SHAPE.noteWidth * L.W).toBe(160);
    expect(L.N).toBe(20);
    const P = computeLayout('portrait');
    expect(SHAPE.noteWidth * P.W).toBe(320);
    expect(P.N).toBe(40);
  });
});

describe('defaultLeadMs', () => {
  it('portrait 1200, landscape 1600, divided by hiSpeed', () => {
    expect(defaultLeadMs('portrait', 1)).toBe(1200);
    expect(defaultLeadMs('landscape', 1)).toBe(1600);
    expect(defaultLeadMs('portrait', 2)).toBe(600);
    expect(defaultLeadMs('landscape', 0.5)).toBe(3200);
  });

  it('falls back to 1× for a nonsense hiSpeed', () => {
    expect(defaultLeadMs('portrait', 0)).toBe(1200);
    expect(defaultLeadMs('landscape', Number.NaN)).toBe(1600);
    expect(defaultLeadMs('landscape', -1)).toBe(1600);
  });
});
