/**
 * Render module (PLAN §8): PixiJS stage + track renderer + layouts.
 */
export * from './types.ts';
export { createStage } from './stage.ts';
export { createTrackRenderer } from './track.ts';
export {
  computeLayout,
  defaultLeadMs,
  defaultLogical,
  portraitLogical,
  portraitTouchHeight,
  touchAreaTop,
  gateCells,
  gateCellsLocal,
  gateGap,
  localFrame,
  localToScreen,
  nearClipPx,
  progressDirection,
  screenToLocal,
  seamPosition,
  trackNearPx,
  PORTRAIT_SPACING,
} from './layout.ts';
export type { LocalFrame, Logical, Vec2 } from './layout.ts';
export { noteDiameter, bigDiameter } from './shapes.ts';
