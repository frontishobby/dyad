/**
 * Render contracts (PLAN §3, DESIGN §2/§4/§5).
 *
 * The track renderer works in TRACK-LOCAL coordinates: a progress axis (notes
 * travel from far → near, the gate is at near) and a width axis (left hand →
 * right hand). The layout decides orientation and placement. One renderer, two
 * layouts. Everything is Pixi Graphics; no textures except the jacket.
 */
import type { Container } from 'pixi.js';
import type { Chart, Engine, EngineEvent, Key } from '../core/types.ts';
import type { Theme } from '../design/tokens.ts';
import type { Rect } from '../input/types.ts';

export type Orientation = 'portrait' | 'landscape';

/** All rectangles in logical pixels (1280×720 or 720×1280). */
export interface Layout {
  orientation: Orientation;
  logical: { w: number; h: number };
  /** Track rectangle in screen space. */
  track: Rect;
  /** Track width W (hand axis) and note thickness N = W/12. */
  W: number;
  N: number;
  /** Position of the judgement seam along the progress axis, in screen space. */
  gate: Rect;
  /** Song info strip. */
  info: Rect;
  /** Portrait only. */
  touchZones?: Record<Key, Rect>;
  /** Progress axis length in px from spawn edge to the gate seam. */
  leadPx: number;
}

export function isPortrait(o: Orientation): boolean {
  return o === 'portrait';
}

export interface TrackRendererOptions {
  chart: Chart;
  theme: Theme;
  layout: Layout;
  /** Time from spawn edge to gate, ms. Portrait default 750, landscape 900; scaled by hiSpeed. */
  leadMs: number;
  /** Key labels on gate cells (keyboard mode only). */
  keyLabels?: Record<Key, string>;
  reducedMotion: boolean;
}

export interface TrackRenderer {
  /** Add this to the stage. */
  readonly view: Container;
  setLayout(layout: Layout): void;
  setLeadMs(ms: number): void;
  /** Called every animation frame with the song clock. Reads engine.noteView(). */
  frame(songMs: number, engine: Engine): void;
  /** Judge effects: cell flash, note vanish, miss desaturation. */
  apply(events: readonly EngineEvent[], songMs: number): void;
  /** Gate cell + touch zone lit while a key is held. */
  press(key: Key, down: boolean): void;
  destroy(): void;
}

/**
 * Landscape: a fixed 1280×720 logical stage, aspect-fit into the container,
 * scale ≤ 1 (never upscaled), letterbox in `void`.
 * Portrait: logical width 720, logical HEIGHT FOLLOWS THE CONTAINER ASPECT
 * (clamped by LAYOUT.portrait.min/maxHeight); the canvas fills the container
 * exactly (scale = containerWidth / 720, may exceed 1), no letterbox. When the
 * container resizes, `logical` changes and `onResize` listeners fire so the
 * play screen can recompute the layout and call TrackRenderer.setLayout().
 */
export interface Stage {
  readonly canvas: HTMLCanvasElement;
  readonly stage: Container;
  readonly orientation: Orientation;
  /** Current logical size. Constant in landscape; height varies in portrait. */
  readonly logical: { w: number; h: number };
  /** CSS px per logical px currently applied. */
  readonly scale: number;
  /** Map client coordinates to logical coordinates. */
  toLogical(clientX: number, clientY: number): { x: number; y: number };
  /** Re-fit to the container (also re-derives the portrait logical height). */
  fit(): void;
  /** Called after fit() changed `logical` (portrait only). Returns an unsubscribe. */
  onResize(cb: (logical: { w: number; h: number }) => void): () => void;
  render(): void;
  destroy(): void;
}
