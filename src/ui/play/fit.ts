/**
 * Sizing the stage box inside the viewport.
 *
 * Landscape (computeFit): aspect-fit of the fixed 1280×720 stage, letterboxed,
 * never upscaled (PLAN §3). Portrait (computeFill): the box IS the viewport;
 * the logical width is 720 and the logical height follows the aspect, so the
 * scale is simply viewportW / 720 and may exceed 1 (PLAN §3 "동적 해상도").
 * The DOM HUD is scaled by the same factor as the canvas, so they line up by
 * construction.
 */

export interface Fit {
  /** CSS px size of the stage box. */
  w: number;
  h: number;
  /** CSS px per logical px, ≤ maxScale. */
  scale: number;
  /** Offset of the box inside the viewport (centred). */
  x: number;
  y: number;
}

export function computeFit(
  viewportW: number,
  viewportH: number,
  logicalW: number,
  logicalH: number,
  maxScale = 1,
): Fit {
  if (!(viewportW > 0) || !(viewportH > 0) || !(logicalW > 0) || !(logicalH > 0)) {
    return { w: 0, h: 0, scale: 0, x: 0, y: 0 };
  }
  const raw = Math.min(viewportW / logicalW, viewportH / logicalH, maxScale);
  const w = Math.floor(logicalW * raw);
  const h = Math.floor(logicalH * raw);
  return {
    w,
    h,
    // Same formula the stage applies to a w×h container, so canvas and HUD agree exactly.
    scale: Math.min(w / logicalW, h / logicalH),
    x: Math.floor((viewportW - w) / 2),
    y: Math.floor((viewportH - h) / 2),
  };
}

/** Portrait: the box fills the viewport; scale = viewportW / logicalW (no cap). */
export function computeFill(viewportW: number, viewportH: number, logicalW: number): Fit {
  if (!(viewportW > 0) || !(viewportH > 0) || !(logicalW > 0)) {
    return { w: 0, h: 0, scale: 0, x: 0, y: 0 };
  }
  return { w: viewportW, h: viewportH, scale: viewportW / logicalW, x: 0, y: 0 };
}
