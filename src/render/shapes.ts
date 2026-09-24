/**
 * Shape builders (DESIGN §2). Everything is Pixi Graphics; nothing is textured.
 *
 * Notes are CIRCLES and the type is the colour (don amber, kat periwinkle),
 * as in taiko. A regular note is a disc of diameter d, a big note a disc of
 * diameter D = d × SHAPE.bigCircle, drawn as two half-discs so the renderer
 * can dim the hand that already landed. The judgement seam carries a ring of
 * the big diameter that the notes pass through.
 *
 * Coordinates are TRACK-LOCAL: x along the width axis (left hand → right hand),
 * y along the progress axis with the spawn side at NEGATIVE y (notes travel
 * toward +y and the seam is at y = 0). Shapes are centred on the origin so a
 * pooled instance is positioned with `x = W/2`, `y = −p`.
 *
 * Shapes are filled WHITE and tinted by the renderer: tint = type colour
 * normally, `flash` on a Great, `textFaint` on a Miss. Pixi tint is
 * multiplicative, so a white base is the only way a shape can turn either
 * brighter or greyer. Each shape is built once per layout into a shared
 * GraphicsContext; pooled Graphics instances share it and never rebuild.
 */
import { Graphics, GraphicsContext } from 'pixi.js';
import type { Hand } from '../core/types.ts';
import { SHAPE } from '../design/tokens.ts';

/** Pixi's fill colour for white-base shapes that the renderer tints. */
export const WHITE = 0xffffff;

// ─── sizes (pure) ───────────────────────────────────────────────────────────

/**
 * Regular note diameter for a track whose seam is `leadPx` from the spawn
 * edge: a fraction of the scroll distance, so a 1/4 stream at a typical tempo
 * spaces notes about one diameter apart in both orientations.
 */
export function noteDiameter(leadPx: number): number {
  return leadPx * SHAPE.circle;
}

/** Big note diameter. */
export function bigDiameter(leadPx: number): number {
  return noteDiameter(leadPx) * SHAPE.bigCircle;
}

/** Corner radius law for the remaining bricks (touch zones, bodies): shortest side × SHAPE.radius. */
export function cornerRadius(w: number, h: number): number {
  return Math.min(w, h) * SHAPE.radius;
}

// ─── Pixi contexts ──────────────────────────────────────────────────────────

/** Filled disc of diameter d centred on the origin. White (tinted). */
export function circleContext(d: number): GraphicsContext {
  const ctx = new GraphicsContext();
  ctx.circle(0, 0, d / 2).fill(WHITE);
  return ctx;
}

/**
 * One half of a big note: the left ('L', x ≤ 0) or right ('R', x ≥ 0) half of
 * a disc of diameter D, closed along the seam x = 0. White (tinted).
 */
export function halfCircleContext(D: number, hand: Hand): GraphicsContext {
  const r = D / 2;
  const ctx = new GraphicsContext();
  ctx.moveTo(0, -r);
  // From the top (−π/2) to the bottom (π/2): anticlockwise passes through π (left), clockwise through 0 (right).
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, hand === 'L');
  ctx.closePath();
  ctx.fill(WHITE);
  return ctx;
}

/** Ring (stroke only) of diameter d and stroke width `stroke`, centred on the origin. White (tinted). */
export function ringContext(d: number, stroke: number): GraphicsContext {
  const ctx = new GraphicsContext();
  ctx.circle(0, 0, d / 2).stroke({ width: stroke, color: WHITE, alignment: 0.5 });
  return ctx;
}

/** 1 px seam line at the centre of a big note (height D), in the ground colour (not tinted). */
export function seamContext(D: number, ground: number): GraphicsContext {
  const ctx = new GraphicsContext();
  ctx.rect(-0.5, -D / 2, 1, D).fill(ground);
  return ctx;
}

/** Plain brick (touch zone base, or the white "lit" overlay). Origin at top-left. */
export function brickContext(w: number, h: number, fill: number): GraphicsContext {
  const ctx = new GraphicsContext();
  ctx.roundRect(0, 0, w, h, cornerRadius(w, h)).fill(fill);
  return ctx;
}

/** Touch-zone silhouette: a disc of diameter d centred on the origin, white (tinted with the type colour). */
export function silhouetteContext(d: number): GraphicsContext {
  return circleContext(d);
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

/**
 * Hit burst (DESIGN §5): the note's outline, a ring of the regular or big
 * diameter stroked `stroke` wide. The renderer parks it on the seam, scales
 * it up and fades it after every hit.
 */
export function burstContext(d: number, stroke: number): GraphicsContext {
  return ringContext(d, Math.max(2, stroke));
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

/**
 * Build every note shape once for a track: regular discs of diameter d, big
 * half-discs of diameter D. Don and kat share a shape (the colour tells them
 * apart) but get their own contexts so the pools stay independent.
 */
export function buildNoteContexts(d: number, D: number, ground: number): NoteContexts {
  return {
    don: circleContext(d),
    kat: circleContext(d),
    bigDonL: halfCircleContext(D, 'L'),
    bigDonR: halfCircleContext(D, 'R'),
    bigKatL: halfCircleContext(D, 'L'),
    bigKatR: halfCircleContext(D, 'R'),
    seam: seamContext(D, ground),
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
