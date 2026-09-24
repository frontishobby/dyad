import { describe, expect, it } from 'vitest';
import { standaloneOuterSize } from '../../src/app/pwa.ts';
import { LAYOUT } from '../../src/design/tokens.ts';

describe('standaloneOuterSize', () => {
  it('adds the window chrome to the 1280×720 content size', () => {
    const size = standaloneOuterSize({ innerWidth: 1000, innerHeight: 600, outerWidth: 1016, outerHeight: 680 });
    expect(size).toEqual({ width: LAYOUT.landscape.width + 16, height: LAYOUT.landscape.height + 80 });
  });

  it('never subtracts when the reported outer size is smaller than the inner one', () => {
    const size = standaloneOuterSize({ innerWidth: 1000, innerHeight: 600, outerWidth: 0, outerHeight: 0 });
    expect(size).toEqual({ width: LAYOUT.landscape.width, height: LAYOUT.landscape.height });
  });
});
