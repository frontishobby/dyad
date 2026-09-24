import { describe, expect, it } from 'vitest';
import { decideOrientation, lockTypeFor } from '../../src/ui/play/orientation.ts';

describe('decideOrientation', () => {
  it.each([
    [true, true, 'portrait'],
    [true, false, 'landscape'],
    [false, true, 'landscape'],
    [false, false, 'landscape'],
  ] as const)('portrait media %s, coarse pointer %s → %s', (portrait, coarse, expected) => {
    expect(decideOrientation(portrait, coarse)).toBe(expected);
  });

  it('maps the play orientation straight onto the lock type', () => {
    expect(lockTypeFor('portrait')).toBe('portrait');
    expect(lockTypeFor('landscape')).toBe('landscape');
  });
});
