import { describe, expect, it } from 'vitest';
import type { PlayResult } from '../../src/core/types.ts';
import { SCORES_CAP, createLocalBackend, isPlayResult, scoresKey } from '../../src/backend/local.ts';
import { createMemoryStorage } from '../../src/backend/storage.ts';

const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function result(over: Partial<PlayResult> = {}): PlayResult {
  return {
    chartHash: HASH,
    songId: 'song',
    score: 900_000,
    accuracy: 0.9,
    maxCombo: 100,
    counts: { great: 90, ok: 10, miss: 0 },
    rollTicks: 0,
    spinnerTicks: 0,
    offsets: { audio: 0, input: 0 },
    replay: [[0, 'DL']],
    createdAt: 1_000,
    ...over,
  };
}

describe('createLocalBackend', () => {
  it('stores under dyad:scores:<chartHash> newest first', async () => {
    const storage = createMemoryStorage();
    const backend = createLocalBackend(storage);
    await backend.submitScore(result({ score: 1, createdAt: 100 }));
    await backend.submitScore(result({ score: 2, createdAt: 200 }));
    await backend.submitScore(result({ score: 3, createdAt: 300 }));

    const raw = storage.getItem(scoresKey(HASH));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? '[]').map((r: PlayResult) => r.score)).toEqual([3, 2, 1]);

    const scores = await backend.getScores(HASH);
    expect(scores.map((r) => r.createdAt)).toEqual([300, 200, 100]);
  });

  it('orders by createdAt even when submitted out of order', async () => {
    const backend = createLocalBackend(createMemoryStorage());
    await backend.submitScore(result({ score: 1, createdAt: 300 }));
    await backend.submitScore(result({ score: 2, createdAt: 100 }));
    await backend.submitScore(result({ score: 3, createdAt: 200 }));
    expect((await backend.getScores(HASH)).map((r) => r.score)).toEqual([1, 3, 2]);
  });

  it('honours limit', async () => {
    const backend = createLocalBackend(createMemoryStorage());
    for (let i = 0; i < 5; i++) await backend.submitScore(result({ createdAt: i }));
    expect(await backend.getScores(HASH, 2)).toHaveLength(2);
    expect(await backend.getScores(HASH, 0)).toHaveLength(0);
    expect(await backend.getScores(HASH)).toHaveLength(5);
  });

  it('caps at 50, dropping the oldest', async () => {
    const backend = createLocalBackend(createMemoryStorage());
    for (let i = 0; i < SCORES_CAP + 7; i++) {
      await backend.submitScore(result({ score: i, createdAt: i }));
    }
    const scores = await backend.getScores(HASH);
    expect(scores).toHaveLength(SCORES_CAP);
    expect(scores[0]?.createdAt).toBe(SCORES_CAP + 6);
    expect(scores[SCORES_CAP - 1]?.createdAt).toBe(7);
  });

  it('keeps charts apart', async () => {
    const backend = createLocalBackend(createMemoryStorage());
    await backend.submitScore(result({ chartHash: HASH, score: 10 }));
    await backend.submitScore(result({ chartHash: OTHER, score: 20 }));
    expect((await backend.getScores(HASH)).map((r) => r.score)).toEqual([10]);
    expect((await backend.getScores(OTHER)).map((r) => r.score)).toEqual([20]);
    expect(await backend.getScores('c'.repeat(64))).toEqual([]);
  });

  describe('getBest', () => {
    it('is null with no records', async () => {
      const backend = createLocalBackend(createMemoryStorage());
      expect(await backend.getBest(HASH)).toBeNull();
    });

    it('returns the highest score', async () => {
      const backend = createLocalBackend(createMemoryStorage());
      await backend.submitScore(result({ score: 500, createdAt: 1 }));
      await backend.submitScore(result({ score: 900, createdAt: 2 }));
      await backend.submitScore(result({ score: 700, createdAt: 3 }));
      expect((await backend.getBest(HASH))?.score).toBe(900);
    });

    it('breaks ties toward the newer record', async () => {
      const backend = createLocalBackend(createMemoryStorage());
      await backend.submitScore(result({ score: 900, createdAt: 10, maxCombo: 1 }));
      await backend.submitScore(result({ score: 900, createdAt: 30, maxCombo: 3 }));
      await backend.submitScore(result({ score: 900, createdAt: 20, maxCombo: 2 }));
      const best = await backend.getBest(HASH);
      expect(best?.createdAt).toBe(30);
      expect(best?.maxCombo).toBe(3);
    });
  });

  describe('corrupt storage', () => {
    it('treats invalid JSON as empty and overwrites it on submit', async () => {
      const storage = createMemoryStorage();
      storage.setItem(scoresKey(HASH), '{oops');
      const backend = createLocalBackend(storage);
      expect(await backend.getScores(HASH)).toEqual([]);
      expect(await backend.getBest(HASH)).toBeNull();
      await backend.submitScore(result({ score: 5 }));
      expect((await backend.getScores(HASH)).map((r) => r.score)).toEqual([5]);
    });

    it('treats a non-array as empty', async () => {
      const storage = createMemoryStorage();
      storage.setItem(scoresKey(HASH), JSON.stringify({ score: 1 }));
      expect(await createLocalBackend(storage).getScores(HASH)).toEqual([]);
    });

    it('drops malformed entries but keeps valid ones', async () => {
      const storage = createMemoryStorage();
      storage.setItem(
        scoresKey(HASH),
        JSON.stringify([result({ score: 1 }), null, { score: 'x' }, 'str', result({ score: 2, createdAt: 2_000 })]),
      );
      const scores = await createLocalBackend(storage).getScores(HASH);
      expect(scores.map((r) => r.score)).toEqual([2, 1]);
    });

    it('survives getItem/setItem throwing', async () => {
      const throwing: Storage = {
        ...createMemoryStorage(),
        getItem(): string | null {
          throw new Error('blocked');
        },
        setItem(): void {
          throw new Error('quota');
        },
      };
      const backend = createLocalBackend(throwing);
      await expect(backend.submitScore(result())).resolves.toBeUndefined();
      expect(await backend.getScores(HASH)).toEqual([]);
      expect(await backend.getBest(HASH)).toBeNull();
    });

    it('shrinks the list when the write hits a quota', async () => {
      const inner = createMemoryStorage();
      const limit = 600; // bytes; each record is roughly 200
      const quota: Storage = {
        ...inner,
        getItem: (k) => inner.getItem(k),
        setItem(k: string, v: string) {
          if (v.length > limit) throw new Error('QuotaExceededError');
          inner.setItem(k, v);
        },
      };
      const backend = createLocalBackend(quota);
      for (let i = 0; i < 10; i++) await backend.submitScore(result({ score: i, createdAt: i }));
      const scores = await backend.getScores(HASH);
      expect(scores.length).toBeGreaterThan(0);
      expect(scores.length).toBeLessThan(10);
      // The newest record always survives.
      expect(scores[0]?.createdAt).toBe(9);
    });
  });

  it('rejects things that are not PlayResults', async () => {
    const backend = createLocalBackend(createMemoryStorage());
    await expect(backend.submitScore({ score: 1 } as unknown as PlayResult)).rejects.toThrow(TypeError);
    expect(isPlayResult(result())).toBe(true);
    expect(isPlayResult({ ...result(), counts: { great: 1 } })).toBe(false);
    expect(isPlayResult({ ...result(), chartHash: '' })).toBe(false);
  });

  it('returns detached copies', async () => {
    const backend = createLocalBackend(createMemoryStorage());
    const r = result();
    await backend.submitScore(r);
    r.score = 0;
    const stored = await backend.getScores(HASH);
    expect(stored[0]?.score).toBe(900_000);
    if (stored[0]) stored[0].score = 1;
    expect((await backend.getScores(HASH))[0]?.score).toBe(900_000);
  });
});
