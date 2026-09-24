/**
 * Layout (PLAN §3, DESIGN §4). Pure: no Pixi, no DOM.
 *
 * The renderer draws in TRACK-LOCAL coordinates and this module decides where
 * that frame sits on the logical screen:
 *
 *   local x  = u × W        width axis, 0 = left hand edge … W = right hand edge
 *   local y  = −p           progress axis, p ≥ 0 is the spawn side of the seam,
 *                           p = 0 is the judgement seam, p < 0 is past the gate
 *
 * Portrait: the frame is a translation (notes fall down the screen).
 * Landscape: the frame is rotated +90° (notes travel right → left, the top half
 * of the band is the left hand). One renderer, one transform per orientation.
 *
 * Logical sizes: landscape is fixed 1280×720. Portrait is 720 wide and as tall
 * as the viewport's aspect ratio makes it (see portraitLogical()), so the
 * caller passes the logical size in; computeLayout(orientation) alone uses
 * defaultLogical().
 */
import type { Key } from '../core/types.ts';
import { LAYOUT, SHAPE } from '../design/tokens.ts';
import type { Rect } from '../input/types.ts';
import type { Layout, Orientation } from './types.ts';

export interface Logical {
  w: number;
  h: number;
}

/** Portrait-only spacing constants (logical px). */
export const PORTRAIT_SPACING = {
  /** Track gutter on each side; the touch grid uses the same gutter. */
  sideGutter: LAYOUT.portrait.gutterPx,
  /** Gap between touch cells and inset above/below the touch grid. */
  touchGap: 12,
  /** Space between the gate's near edge and the top of the touch area. */
  gateClearance: 16,
} as const;

export interface LocalFrame {
  /** Screen position of the local origin (u = 0, p = 0). */
  x: number;
  y: number;
  /** Rotation in radians for a Pixi container holding local-coordinate children. */
  rotation: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

// ─── logical sizes ──────────────────────────────────────────────────────────

/** Landscape 1280×720; portrait 720×1280 (a 9:16 phone) when no viewport is known. */
export function defaultLogical(orientation: Orientation): Logical {
  return orientation === 'landscape'
    ? { w: LAYOUT.landscape.width, h: LAYOUT.landscape.height }
    : { w: LAYOUT.portrait.width, h: 1280 };
}

/**
 * Portrait logical size for a viewport: width fixed at 720, height follows
 * the viewport aspect, clamped so extreme aspects still get a sane layout.
 */
export function portraitLogical(viewportW: number, viewportH: number): Logical {
  const { width, minHeight, maxHeight } = LAYOUT.portrait;
  if (!(viewportW > 0) || !(viewportH > 0)) return defaultLogical('portrait');
  const h = Math.round((width * viewportH) / viewportW);
  return { w: width, h: Math.max(minHeight, Math.min(maxHeight, h)) };
}

/** Height of the portrait touch area for a logical height. */
export function portraitTouchHeight(logicalH: number): number {
  return Math.max(Math.round(logicalH * LAYOUT.portrait.touch), LAYOUT.portrait.touchMinPx);
}

// ─── computeLayout ──────────────────────────────────────────────────────────

export function computeLayout(orientation: Orientation, logical: Logical = defaultLogical(orientation)): Layout {
  return orientation === 'portrait' ? portraitLayout(logical) : landscapeLayout(logical);
}

function portraitLayout(logical: Logical): Layout {
  const lw = logical.w;
  const lh = logical.h;
  const { sideGutter, touchGap, gateClearance } = PORTRAIT_SPACING;

  const infoH = LAYOUT.portrait.infoPx;
  const touchH = portraitTouchHeight(lh);
  const touchTop = lh - touchH;

  const W = lw - sideGutter * 2;
  const N = W * SHAPE.noteThickness;
  const gap = N * SHAPE.gateGap;

  // Gate: kat row far (top), don row near (bottom), seam in the middle of the gap.
  const gateNear = touchTop - gateClearance;
  const donRowY = gateNear - N;
  const katRowY = donRowY - gap - N;
  const gate: Rect = { x: sideGutter, y: katRowY, w: W, h: N * 2 + gap };
  const seamY = donRowY - gap / 2;

  const track: Rect = { x: sideGutter, y: infoH, w: W, h: katRowY - infoH };
  const info: Rect = { x: 0, y: 0, w: lw, h: infoH };

  // Touch zones: 2×2, KL/KR top row, DL/DR bottom row.
  const cellW = (W - touchGap) / 2;
  const cellH = (touchH - touchGap * 3) / 2;
  const col0 = sideGutter;
  const col1 = sideGutter + cellW + touchGap;
  const row0 = touchTop + touchGap;
  const row1 = row0 + cellH + touchGap;
  const touchZones: Record<Key, Rect> = {
    KL: { x: col0, y: row0, w: cellW, h: cellH },
    KR: { x: col1, y: row0, w: cellW, h: cellH },
    DL: { x: col0, y: row1, w: cellW, h: cellH },
    DR: { x: col1, y: row1, w: cellW, h: cellH },
  };

  return {
    orientation: 'portrait',
    logical: { w: lw, h: lh },
    track,
    W,
    N,
    gate,
    info,
    touchZones,
    leadPx: seamY - track.y,
  };
}

function landscapeLayout(logical: Logical): Layout {
  const lw = logical.w;
  const lh = logical.h;

  const trackH = LAYOUT.landscape.trackHeightPx;
  const trackY = Math.min(LAYOUT.landscape.trackTopPx, lh - trackH);

  const W = trackH;
  const N = W * SHAPE.noteThickness;
  const gap = N * SHAPE.gateGap;

  const seamX = lw * LAYOUT.landscape.gateX;
  // Don column near (left of the seam), kat column far (right of the seam).
  const donColX = seamX - gap / 2 - N;
  const gate: Rect = { x: donColX, y: trackY, w: N * 2 + gap, h: W };

  const track: Rect = { x: 0, y: trackY, w: lw, h: W };
  const info: Rect = { x: 0, y: 0, w: lw, h: trackY };

  return {
    orientation: 'landscape',
    logical: { w: lw, h: lh },
    track,
    W,
    N,
    gate,
    info,
    leadPx: lw - seamX,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Gate gap between cells (both axes), from N. */
export function gateGap(layout: Layout): number {
  return layout.N * SHAPE.gateGap;
}

/**
 * Position of the judgement seam along the progress axis, in screen space:
 * a y coordinate in portrait, an x coordinate in landscape.
 */
export function seamPosition(layout: Layout): number {
  return layout.orientation === 'portrait'
    ? layout.gate.y + layout.gate.h / 2
    : layout.gate.x + layout.gate.w / 2;
}

const DIR_PORTRAIT: Readonly<Vec2> = Object.freeze({ x: 0, y: -1 });
const DIR_LANDSCAPE: Readonly<Vec2> = Object.freeze({ x: 1, y: 0 });

/** Unit vector, in screen space, of increasing p (from the seam toward spawn). */
export function progressDirection(layout: Layout): Readonly<Vec2> {
  return layout.orientation === 'portrait' ? DIR_PORTRAIT : DIR_LANDSCAPE;
}

/**
 * Pixi transform for a container whose children are drawn in local coordinates
 * (x = u × W, y = −p). Landscape is the local frame rotated +90°: local −y
 * (spawn side) becomes screen +x, local +x (right hand) becomes screen +y.
 */
export function localFrame(layout: Layout): LocalFrame {
  const seam = seamPosition(layout);
  return layout.orientation === 'portrait'
    ? { x: layout.track.x, y: seam, rotation: 0 }
    : { x: seam, y: layout.track.y, rotation: Math.PI / 2 };
}

/**
 * Map track-local (p: px from the seam toward spawn, u: 0..1 left → right hand)
 * to screen coordinates. Pass `out` to avoid allocating.
 */
export function localToScreen(layout: Layout, p: number, u: number, out?: Vec2): Vec2 {
  const o = out ?? { x: 0, y: 0 };
  const seam = seamPosition(layout);
  if (layout.orientation === 'portrait') {
    o.x = layout.track.x + u * layout.W;
    o.y = seam - p;
  } else {
    o.x = seam + p;
    o.y = layout.track.y + u * layout.W;
  }
  return o;
}

/** Inverse of localToScreen. */
export function screenToLocal(layout: Layout, x: number, y: number, out?: { p: number; u: number }) {
  const o = out ?? { p: 0, u: 0 };
  const seam = seamPosition(layout);
  if (layout.orientation === 'portrait') {
    o.p = seam - y;
    o.u = (x - layout.track.x) / layout.W;
  } else {
    o.p = x - seam;
    o.u = (y - layout.track.y) / layout.W;
  }
  return o;
}

/**
 * p of the track rectangle's near edge. Portrait: the track stops at the kat
 * row, before the seam (positive). Landscape: the track runs to the screen
 * edge past the gate (negative).
 */
export function trackNearPx(layout: Layout): number {
  if (layout.orientation === 'portrait') {
    return seamPosition(layout) - (layout.track.y + layout.track.h);
  }
  return layout.track.x - seamPosition(layout);
}

/** Top of the portrait touch area in screen space (the touch grid's inset edge). */
export function touchAreaTop(layout: Layout): number {
  const tz = layout.touchZones;
  if (!tz) return layout.logical.h;
  return tz.KL.y - PORTRAIT_SPACING.touchGap;
}

/**
 * p at which notes must be clipped on the near side (negative): the top of the
 * touch area in portrait, the screen edge in landscape.
 */
export function nearClipPx(layout: Layout): number {
  if (layout.orientation === 'portrait') {
    return seamPosition(layout) - touchAreaTop(layout);
  }
  return layout.track.x - seamPosition(layout);
}

/**
 * Gate cells in LOCAL coordinates, identical for both orientations: the kat row
 * is on the spawn side (y < 0), the don row on the near side (y > 0); the left
 * column is the left hand.
 */
export function gateCellsLocal(layout: Layout): Record<Key, Rect> {
  const { W, N } = layout;
  const gap = gateGap(layout);
  const colW = (W - gap) / 2;
  const katY = -(gap / 2 + N);
  const donY = gap / 2;
  return {
    KL: { x: 0, y: katY, w: colW, h: N },
    KR: { x: colW + gap, y: katY, w: colW, h: N },
    DL: { x: 0, y: donY, w: colW, h: N },
    DR: { x: colW + gap, y: donY, w: colW, h: N },
  };
}

/** Gate cells in screen space (axis-aligned in both orientations). */
export function gateCells(layout: Layout): Record<Key, Rect> {
  const local = gateCellsLocal(layout);
  const out = {} as Record<Key, Rect>;
  for (const key of Object.keys(local) as Key[]) {
    const c = local[key];
    const a = localToScreen(layout, -c.y, c.x / layout.W);
    const b = localToScreen(layout, -(c.y + c.h), (c.x + c.w) / layout.W);
    out[key] = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    };
  }
  return out;
}

/** Lead time from spawn edge to gate at hiSpeed 1 (LAYOUT.leadMs), divided by hiSpeed. */
export function defaultLeadMs(orientation: Orientation, hiSpeed: number): number {
  const base = LAYOUT.leadMs[orientation];
  const speed = hiSpeed > 0 && Number.isFinite(hiSpeed) ? hiSpeed : 1;
  return base / speed;
}
