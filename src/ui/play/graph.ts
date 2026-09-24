/**
 * Result graph geometry (DESIGN §5): the running accuracy as a line over the
 * song, with a judgement strip underneath. Pure; the SVG is stretched to its
 * box (preserveAspectRatio none) and strokes are non-scaling.
 */
import type { Judgement } from '../../core/types.ts';
import type { TimelinePoint } from '../../core/timeline.ts';

/** SVG viewBox. The line lives in [0, LINE_H], the strip below it. */
export const GRAPH_W = 1000;
export const GRAPH_H = 100;
export const LINE_H = 76;
export const STRIP_TOP = 84;
export const STRIP_H = 16;

export interface Tick {
  x: number;
  judgement: Judgement;
}

/** x for a song time, 0..GRAPH_W. */
export function xAt(t: number, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  const k = Math.min(1, Math.max(0, t / durationMs));
  return k * GRAPH_W;
}

/** y for an accuracy, 0..1 → LINE_H..0 (100 % at the top). */
export function yAt(accuracy: number): number {
  const a = Math.min(1, Math.max(0, accuracy));
  return LINE_H - a * LINE_H;
}

/** Polyline points "x,y x,y …" for the running accuracy; empty when there are no notes. */
export function accuracyPath(points: readonly TimelinePoint[], durationMs: number): string {
  if (points.length === 0) return '';
  const out: string[] = [];
  const first = points[0] as TimelinePoint;
  // Hold the first value from the song start so the line does not begin mid-air.
  out.push(`0,${yAt(first.accuracy).toFixed(2)}`);
  for (const p of points) out.push(`${xAt(p.t, durationMs).toFixed(2)},${yAt(p.accuracy).toFixed(2)}`);
  const last = points[points.length - 1] as TimelinePoint;
  out.push(`${GRAPH_W},${yAt(last.accuracy).toFixed(2)}`);
  return out.join(' ');
}

/** One tick per note on the strip. */
export function judgementTicks(points: readonly TimelinePoint[], durationMs: number): Tick[] {
  return points.map((p) => ({ x: xAt(p.t, durationMs), judgement: p.judgement }));
}
