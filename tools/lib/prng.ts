/**
 * mulberry32: a tiny seeded PRNG. The fixture generator never touches
 * Math.random so the same seed always yields the same noise bytes.
 */
export interface Prng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [-1, 1). */
  noise(): number;
}

export function mulberry32(seed: number): Prng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, noise: () => next() * 2 - 1 };
}
