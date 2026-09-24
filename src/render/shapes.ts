/**
 * Shape builders (DESIGN §2). Everything is Pixi Graphics; nothing is textured.
 *
 * Coordinates are TRACK-LOCAL: x along the width axis (left hand → right hand),
 * y along the progress axis with the spawn side at NEGATIVE y (notes travel
 * toward +y and the seam is at y = 0). Note shapes are centred on the origin so
 * a pooled instance is positioned with `x = W/2 (+ offset)`, `y = −p`.
 *
 * Note shapes are filled WHITE and tinted by the renderer: tint = type colour
 * normally, `flash` on a Great, `textFaint` on a Miss. Pixi tint is
 * multiplicative, so a white base is the only way a note can turn either
 * brighter or greyer. Each shape is built once per (W, N) into a shared
 * GraphicsContext; pooled Graphics instances share it and never rebuild.
 *
 * The pure point builders (chevronPoints, mPoints, brickPoints) have no Pixi
 * dependency in their bodies and are what the unit tests exercise.
 */
import { Graphics, GraphicsContext } from 'pixi.js';
import type { PointData, RoundedPoint } from 'pixi.js';
import type { Hand, NoteKind } from '../core/types.ts';
import { SHAPE } from '../design/tokens.ts';

/** Pixi's fill colour for white-base shapes that the renderer tints. */
export const WHITE = 0xffffff;

// ─── pure geometry ──────────────────────────────────────────────────────────

/** Axis-aligned brick centred on the origin. Corners in clockwise order from top-left. */
export function brickPoints(width: number, thickness: number): PointData[] {
  const hw = width / 2;
  const ht = thickness / 2;
  return [
    { x: -hw, y: -ht },
    { x: hw, y: -ht },
    { x: hw, y: ht },
    { x: -hw, y: ht },
  ];
}

/**
 * Kat chevron: a bent brick of constant vertical thickness `thickness` whose
 * centre rises by `peak` toward the spawn side (−y). Six points, clockwise
 * from the far-left corner: outer edge left → apex → right, then inner edge
 * right → inner apex → left.
 */
export function chevronPoints(width: number, thickness: number, peak: number = thickness * SHAPE.katPeak): PointData[] {
  const hw = width / 2;
  const ht = thickness / 2;
  return [
    { x: -hw, y: -ht },
    { x: 0, y: -ht - peak },
    { x: hw, y: -ht },
    { x: hw, y: ht },
    { x: 0, y: ht - peak },
    { x: -hw, y: ht },
  ];
}

/**
 * Big kat: two chevrons of width W/2 joined at the centre into an M. Ten
 * points, clockwise from the far-left corner. The valley at x = 0 sits on the
 * outer edge line (y = −thickness/2), where the 1 px seam line is drawn.
 */
export function mPoints(W: number, thickness: number, peak: number = thickness * SHAPE.katPeak): PointData[] {
  const hw = W / 2;
  const qw = W / 4;
  const ht = thickness / 2;
  return [
    { x: -hw, y: -ht },
    { x: -qw, y: -ht - peak },
    { x: 0, y: -ht },
    { x: qw, y: -ht - peak },
    { x: hw, y: -ht },
    { x: hw, y: ht },
    { x: qw, y: ht - peak },
    { x: 0, y: ht },
    { x: -qw, y: ht - peak },
    { x: -hw, y: ht },
  ];
}

/** Translate a point list (returns a new list). */
export function translatePoints(points: readonly PointData[], dx: number, dy: number): PointData[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Attach per-corner radii: corners on the seam side (x ≈ 0 after `shift`)
 * stay square so the two halves of a big note read as one brick with a seam.
 */
export function halfCornerRadii(points: readonly PointData[], radius: number, eps = 1e-6): RoundedPoint[] {
  return points.map((p) => ({ x: p.x, y: p.y, radius: Math.abs(p.x) < eps ? 0 : radius }));
}

/** Corner radius law: shortest side × SHAPE.radius. */
export function cornerRadius(w: number, h: number): number {
  return Math.min(w, h) * SHAPE.radius;
}

/** Regular note width for a track of width W. */
export function noteWidth(W: number): number {
  return W * SHAPE.noteWidth;
}

// ─── Pixi contexts ──────────────────────────────────────────────────────────

function polyContext(points: RoundedPoint[], radius: number, color: number): GraphicsContext {
  const ctx = new GraphicsContext();
  ctx.roundShape(points, radius).fill(color);
  return ctx;
}

/** Regular don: straight brick, 0.6 W × N, radius N/8. White (tinted). */
export function donContext(W: number, N: number): GraphicsContext {
  const w = noteWidth(W);
  const ctx = new GraphicsContext();
  ctx.roundRect(-w / 2, -N / 2, w, N, cornerRadius(w, N)).fill(WHITE);
  return ctx;
}

/** Regular kat: chevron, 0.6 W wide, thickness N, peak N × SHAPE.katPeak. White (tinted). */
export function katContext(W: number, N: number, peak: number = N * SHAPE.katPeak): GraphicsContext {
  const w = noteWidth(W);
  return polyContext(chevronPoints(w, N, peak), cornerRadius(w, N), WHITE);
}

/**
 * One half of a big don (full W wide brick). The outer corners are rounded,
 * the corners on the seam are square. Halves are separate so the renderer can
 * dim the hand that already landed while the partner is awaited.
 */
export function bigDonHalfContext(W: number, N: number, hand: Hand): GraphicsContext {
  const r = cornerRadius(W, N);
  const half = W / 2;
  const points: RoundedPoint[] =
    hand === 'L'
      ? [
          { x: -half, y: -N / 2, radius: r },
          { x: 0, y: -N / 2, radius: 0 },
          { x: 0, y: N / 2, radius: 0 },
          { x: -half, y: N / 2, radius: r },
        ]
      : [
          { x: 0, y: -N / 2, radius: 0 },
          { x: half, y: -N / 2, radius: r },
          { x: half, y: N / 2, radius: r },
          { x: 0, y: N / 2, radius: 0 },
        ];
  return polyContext(points, r, WHITE);
}

/** One half of a big kat (the M): a W/2 chevron shifted to its side, square on the seam. */
export function bigKatHalfContext(W: number, N: number, hand: Hand, peak: number = N * SHAPE.katPeak): GraphicsContext {
  const r = cornerRadius(W, N);
  const shift = hand === 'L' ? -W / 4 : W / 4;
  const points = halfCornerRadii(translatePoints(chevronPoints(W / 2, N, peak), shift, 0), r);
  return polyContext(points, r, WHITE);
}

/**
 * Hit burst (DESIGN §5): the note's own outline — regular or big, brick or
 * chevron — stroked white N/4 thick and centred on the origin. The renderer
 * parks it on the seam, scales it up and fades it after every hit.
 */
export function burstContext(kind: NoteKind, big: boolean, W: number, N: number): GraphicsContext {
  const w = big ? W : noteWidth(W);
  const r = cornerRadius(w, N);
  const stroke = { width: Math.max(2, N / 4), color: WHITE, join: 'round' as const };
  const ctx = new GraphicsContext();
  if (kind === 'd') ctx.roundRect(-w / 2, -N / 2, w, N, r).stroke(stroke);
  else ctx.roundShape(big ? mPoints(W, N) : chevronPoints(w, N), r).stroke(stroke);
  return ctx;
}

/** 1 px seam line at the centre of a big note, in the ground colour (not tinted). */
export function seamContext(N: number, ground: number): GraphicsContext {
  const ctx = new GraphicsContext();
  ctx.rect(-0.5, -N / 2, 1, N).fill(ground);
  return ctx;
}

/** Gate cell at rest: raised fill, 1 px line stroke inside the shape. Origin at the cell's top-left. */
export function gateCellContext(w: number, h: number, fill: number, line: number): GraphicsContext {
  const ctx = new GraphicsContext();
  ctx.roundRect(0, 0, w, h, cornerRadius(w, h)).fill(fill).stroke({ width: 1, color: line, alignment: 1 });
  return ctx;
}

/** Plain brick (touch zone base, or the white "lit" overlay for cells and zones). Origin at top-left. */
export function brickContext(w: number, h: number, fill: number): GraphicsContext {
  const ctx = new GraphicsContext();
  ctx.roundRect(0, 0, w, h, cornerRadius(w, h)).fill(fill);
  return ctx;
}

/**
 * Touch-zone silhouette: a miniature brick (don) or chevron (kat) centred on
 * the origin, `width` wide, width/4 thick, drawn in the faint text colour.
 */
export function silhouetteContext(kind: NoteKind, width: number, color: number): GraphicsContext {
  const thickness = width / 4;
  const r = cornerRadius(width, thickness);
  if (kind === 'd') {
    const ctx = new GraphicsContext();
    ctx.roundRect(-width / 2, -thickness / 2, width, thickness, r).fill(color);
    return ctx;
  }
  return polyContext(chevronPoints(width, thickness, thickness * SHAPE.katPeak), r, color);
}

/** 1 px line across the width axis, centred on y = 0, from x = 0 to W. */
export function lineContext(W: number, color: number): GraphicsContext {
  const ctx = new GraphicsContext();
  ctx.rect(0, -0.5, W, 1).fill(color);
  return ctx;
}

/** Dashed hand divider down the centre of the width axis, from y0 to y1 (y0 < y1). */
export function dividerContext(W: number, y0: number, y1: number, color: number, dash = 8, gap = 8): GraphicsContext {
  const ctx = new GraphicsContext();
  const x = W / 2 - 0.5;
  for (let y = y0; y < y1; y += dash + gap) {
    ctx.rect(x, y, 1, Math.min(dash, y1 - y));
  }
  ctx.fill(color);
  return ctx;
}

/** Filled rectangle (track background, masks). */
export function rectContext(x: number, y: number, w: number, h: number, color: number): GraphicsContext {
  const ctx = new GraphicsContext();
  ctx.rect(x, y, w, h).fill(color);
  return ctx;
}

/** A pooled instance sharing a prebuilt context. */
export function instance(context: GraphicsContext): Graphics {
  const g = new Graphics({ context });
  g.visible = false;
  return g;
}

// ─── note context bundle ────────────────────────────────────────────────────

export interface NoteContexts {
  don: GraphicsContext;
  kat: GraphicsContext;
  bigDonL: GraphicsContext;
  bigDonR: GraphicsContext;
  bigKatL: GraphicsContext;
  bigKatR: GraphicsContext;
  seam: GraphicsContext;
}

/** Build every note shape once for a track of width W (N = W/12). */
export function buildNoteContexts(W: number, N: number, ground: number): NoteContexts {
  return {
    don: donContext(W, N),
    kat: katContext(W, N),
    bigDonL: bigDonHalfContext(W, N, 'L'),
    bigDonR: bigDonHalfContext(W, N, 'R'),
    bigKatL: bigKatHalfContext(W, N, 'L'),
    bigKatR: bigKatHalfContext(W, N, 'R'),
    seam: seamContext(N, ground),
  };
}

export function destroyNoteContexts(c: NoteContexts): void {
  c.don.destroy();
  c.kat.destroy();
  c.bigDonL.destroy();
  c.bigDonR.destroy();
  c.bigKatL.destroy();
  c.bigKatR.destroy();
  c.seam.destroy();
}
