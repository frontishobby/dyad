/**
 * LocalBackend (PLAN §12): records in localStorage, keyed by chartHash.
 *
 * Key: 'dyad:scores:<chartHash>' → JSON array of PlayResult, newest first,
 * at most SCORES_CAP entries. Every storage call is guarded: a blocked or full
 * storage degrades to "no records", never to an exception reaching the UI.
 */
import type { PlayResult } from '../core/types.ts';
import type { Backend } from './types.ts';
import { safeLocalStorage } from './storage.ts';

export const SCORES_PREFIX = 'dyad:scores:';
export const SCORES_CAP = 50;

export function scoresKey(chartHash: string): string {
  return `${SCORES_PREFIX}${chartHash}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Shape check for one stored record. Corrupt entries are dropped on read. */
export function isPlayResult(v: unknown): v is PlayResult {
  if (!isRecord(v)) return false;
  if (typeof v.chartHash !== 'string' || v.chartHash.length === 0) return false;
  if (typeof v.songId !== 'string') return false;
  if (!isFiniteNumber(v.score) || !isFiniteNumber(v.accuracy) || !isFiniteNumber(v.maxCombo)) return false;
  if (!isFiniteNumber(v.createdAt)) return false;
  if (!isFiniteNumber(v.rollTicks) || !isFiniteNumber(v.spinnerTicks)) return false;
  const counts = v.counts;
  if (!isRecord(counts) || !isFiniteNumber(counts.great) || !isFiniteNumber(counts.ok) || !isFiniteNumber(counts.miss)) {
    return false;
  }
  const offsets = v.offsets;
  if (!isRecord(offsets) || !isFiniteNumber(offsets.audio) || !isFiniteNumber(offsets.input)) return false;
  if (!Array.isArray(v.replay)) return false;
  return true;
}

/** Newest first: createdAt descending, insertion order for ties (stable sort). */
function byNewest(a: PlayResult, b: PlayResult): number {
  return b.createdAt - a.createdAt;
}

export function createLocalBackend(storage?: Storage): Backend {
  const store = storage ?? safeLocalStorage();

  function read(chartHash: string): PlayResult[] {
    let raw: string | null;
    try {
      raw = store.getItem(scoresKey(chartHash));
    } catch {
      return [];
    }
    if (!raw) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPlayResult).sort(byNewest);
  }

  /**
   * Write newest-first list. On failure (quota: replays can be large) retry
   * with fewer entries so the newest record survives whenever anything can.
   */
  function write(chartHash: string, list: readonly PlayResult[]): boolean {
    const key = scoresKey(chartHash);
    let n = Math.min(list.length, SCORES_CAP);
    while (n > 0) {
      try {
        store.setItem(key, JSON.stringify(list.slice(0, n)));
        return true;
      } catch {
        n = n > 1 ? Math.floor(n / 2) : 0;
      }
    }
    return false;
  }

  return {
    async submitScore(result: PlayResult): Promise<void> {
      if (!isPlayResult(result)) {
        throw new TypeError('submitScore: not a PlayResult');
      }
      // Round-trip through JSON so stored data never aliases live (possibly reactive) objects.
      const record = JSON.parse(JSON.stringify(result)) as PlayResult;
      const list = read(result.chartHash);
      list.unshift(record);
      list.sort(byNewest);
      if (!write(result.chartHash, list)) {
        console.warn('dyad: could not persist score for chart', result.chartHash);
      }
    },

    async getScores(chartHash: string, limit?: number): Promise<PlayResult[]> {
      const list = read(chartHash);
      if (limit === undefined) return list;
      return list.slice(0, Math.max(0, Math.floor(limit)));
    },

    async getBest(chartHash: string): Promise<PlayResult | null> {
      let best: PlayResult | null = null;
      for (const r of read(chartHash)) {
        if (best === null || r.score > best.score || (r.score === best.score && r.createdAt > best.createdAt)) {
          best = r;
        }
      }
      return best;
    },
  };
}
