import { describe, expect, it } from 'vitest';
import { canonicalChartBody, chartHash } from '../src/core/hash.ts';

describe('chartHash', () => {
  const body = {
    timing: [{ t: 0, beatLength: 400, meter: 4 }],
    notes: [{ t: 0, k: 'd' as const, big: false }, { t: 400, k: 'k' as const, big: true }],
    rolls: [],
    spinners: [],
  };

  it('is stable across key order and extra fields', async () => {
    const shuffled = {
      spinners: [],
      rolls: [],
      notes: [{ big: false, k: 'd' as const, t: 0, extra: 1 }, { k: 'k' as const, big: true, t: 400 }],
      timing: [{ meter: 4, beatLength: 400, t: 0 }],
    };
    expect(canonicalChartBody(shuffled)).toBe(canonicalChartBody(body));
    expect(await chartHash(shuffled)).toBe(await chartHash(body));
  });

  it('is a 64-char hex sha256 and changes with content', async () => {
    const h = await chartHash(body);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    const other = { ...body, notes: [{ t: 1, k: 'd' as const, big: false }] };
    expect(await chartHash(other)).not.toBe(h);
  });
});
