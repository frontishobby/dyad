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
 * brighter or greyer. The note rim is the exception: it carries its own ink
 * and white and sits over the tinted face. Each shape is built once per
 * layout into a shared GraphicsContext; pooled Graphics instances share it
 * and never rebuild.
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

/**
 * Note rim (DESIGN §2): an `ink` outline on the disc's edge and a white ring
 * just inside it, both within diameter d so the note's footprint stays d.
 * Drawn in its own colours over the tinted face; the renderer tints it only
 * to grey it out on a Miss.
 */
export function rimContext(d: number, inkWidth: number, lightWidth: number, ink: number): GraphicsContext {
  const r = d / 2;
  const ctx = new GraphicsContext();
  ctx.circle(0, 0, r - inkWidth / 2).stroke({ width: inkWidth, color: ink, alignment: 0.5 });
  ctx.circle(0, 0, r - inkWidth - lightWidth / 2).stroke({ width: lightWidth, color: WHITE, alignment: 0.5 });
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
  donRim: GraphicsContext;
  katRim: GraphicsContext;
  bigDonRim: GraphicsContext;
  bigKatRim: GraphicsContext;
}

/**
 * Build every note shape once for a track: regular discs of diameter d, big
 * half-discs of diameter D, and a rim for each in its type's ink (`onDon`,
 * `onKat`). Rim strokes come from d for both sizes so every note has the same
 * line weight. Don and kat share a face shape (the colour tells them apart)
 * but get their own contexts so the pools stay independent.
 */
export function buildNoteContexts(d: number, D: number, onDon: number, onKat: number): NoteContexts {
  const ink = d * SHAPE.rimInk;
  const light = d * SHAPE.rimLight;
  return {
    don: circleContext(d),
    kat: circleContext(d),
    bigDonL: halfCircleContext(D, 'L'),
    bigDonR: halfCircleContext(D, 'R'),
    bigKatL: halfCircleContext(D, 'L'),
    bigKatR: halfCircleContext(D, 'R'),
    donRim: rimContext(d, ink, light, onDon),
    katRim: rimContext(d, ink, light, onKat),
    bigDonRim: rimContext(D, ink, light, onDon),
    bigKatRim: rimContext(D, ink, light, onKat),
  };
}

export function destroyNoteContexts(c: NoteContexts): void {
  for (const ctx of Object.values(c)) ctx.destroy();
}
