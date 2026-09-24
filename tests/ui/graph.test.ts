import { describe, expect, it } from 'vitest';
import type { TimelinePoint } from '../../src/core/timeline.ts';
import { GRAPH_W, LINE_H, accuracyPath, judgementTicks, xAt, yAt } from '../../src/ui/play/graph.ts';

const points: TimelinePoint[] = [
  { t: 1000, judgement: 'great', accuracy: 1 },
  { t: 3000, judgement: 'miss', accuracy: 0.5 },
  { t: 4000, judgement: 'ok', accuracy: 0.5 },
];

describe('graph geometry', () => {
  it('maps time across the width and accuracy down from the top', () => {
    expect(xAt(0, 4000)).toBe(0);
    expect(xAt(2000, 4000)).toBe(GRAPH_W / 2);
    expect(xAt(9000, 4000)).toBe(GRAPH_W); // clamped
    expect(xAt(1000, 0)).toBe(0); // no duration
    expect(yAt(1)).toBe(0);
    expect(yAt(0)).toBe(LINE_H);
    expect(yAt(0.5)).toBe(LINE_H / 2);
  });

  it('holds the first value from x = 0 and the last to the right edge', () => {
    const path = accuracyPath(points, 4000);
    const coords = path.split(' ');
    expect(coords[0]).toBe('0,0.00');
    expect(coords[1]).toBe('250.00,0.00');
    expect(coords[coords.length - 1]).toBe(`${GRAPH_W},38.00`);
    expect(accuracyPath([], 4000)).toBe('');
  });

  it('places one tick per note', () => {
    expect(judgementTicks(points, 4000)).toEqual([
      { x: 250, judgement: 'great' },
      { x: 750, judgement: 'miss' },
      { x: 1000, judgement: 'ok' },
    ]);
  });
});
