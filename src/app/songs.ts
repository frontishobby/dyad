/**
 * Song index and chart loading (PLAN §4).
 *
 * Charts are verified twice: the file's declared hash must equal the index
 * entry's, and the recomputed canonical hash must equal the declared one.
 * Anything else is rejected, so records are only ever keyed by a chart hash
 * that really describes the notes played.
 */
import { chartHash } from '../core/hash.ts';
import type { Chart } from '../core/types.ts';
import { TIERS, type SongChartRef, type SongIndex, type SongMeta, type Tier } from './types.ts';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function isBpm(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
}

function isTier(v: unknown): v is Tier {
  return typeof v === 'string' && (TIERS as readonly string[]).includes(v);
}

export function isSongChartRef(v: unknown): v is SongChartRef {
  return (
    isRecord(v) &&
    isTier(v.tier) &&
    typeof v.name === 'string' &&
    typeof v.stars === 'number' &&
    typeof v.level === 'number' &&
    typeof v.file === 'string' &&
    v.file.length > 0 &&
    typeof v.hash === 'string' &&
    v.hash.length > 0 &&
    typeof v.od === 'number' &&
    isBpm(v.bpm) &&
    typeof v.notes === 'number'
  );
}

export function isSongMeta(v: unknown): v is SongMeta {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.title === 'string' &&
    typeof v.artist === 'string' &&
    isStringArray(v.palette) &&
    typeof v.audioOffset === 'number' &&
    typeof v.durationMs === 'number' &&
    typeof v.previewMs === 'number' &&
    typeof v.audio === 'string' &&
    typeof v.jacket === 'string' &&
    typeof v.jacketSm === 'string' &&
    Array.isArray(v.charts) &&
    v.charts.every(isSongChartRef)
  );
}

export function isSongIndex(v: unknown): v is SongIndex {
  return isRecord(v) && v.version === 1 && Array.isArray(v.songs) && v.songs.every(isSongMeta);
}

export function isChart(v: unknown): v is Chart {
  return (
    isRecord(v) &&
    v.version === 1 &&
    isRecord(v.meta) &&
    Array.isArray(v.timing) &&
    Array.isArray(v.notes) &&
    Array.isArray(v.rolls) &&
    Array.isArray(v.spinners) &&
    typeof v.hash === 'string'
  );
}

/** `<BASE_URL>songs/` with exactly one trailing slash. */
export function songsBase(): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base.endsWith('/') ? base : `${base}/`}songs/`;
}

export function songUrl(song: SongMeta, file: string): string {
  return `${songsBase()}${encodeURIComponent(song.id)}/${file}`;
}

export async function loadSongIndex(): Promise<SongIndex> {
  const url = `${songsBase()}index.json`;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`song index: HTTP ${res.status} for ${url}`);
  const data: unknown = await res.json();
  if (!isSongIndex(data)) throw new Error(`song index: unexpected shape in ${url}`);
  // Charts in tier order, whatever the build wrote.
  for (const song of data.songs) song.charts.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
  return data;
}

/** Charts are immutable per hash, so a loaded chart is kept for the session. */
const chartCache = new Map<string, Promise<Chart>>();

export async function loadChart(song: SongMeta, ref: SongChartRef): Promise<Chart> {
  const url = songUrl(song, ref.file);
  const cacheKey = `${url}#${ref.hash}`;
  const cached = chartCache.get(cacheKey);
  if (cached) return cached;

  const pending = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`chart: HTTP ${res.status} for ${url}`);
    const data: unknown = await res.json();
    if (!isChart(data)) throw new Error(`chart: unexpected shape in ${url}`);
    if (data.hash !== ref.hash) {
      throw new Error(`chart: hash mismatch for ${url} (index ${ref.hash}, file ${data.hash})`);
    }
    const computed = await chartHash(data);
    if (computed !== data.hash) {
      throw new Error(`chart: hash mismatch for ${url} (declared ${data.hash}, computed ${computed})`);
    }
    return data;
  })();

  chartCache.set(cacheKey, pending);
  try {
    return await pending;
  } catch (err) {
    chartCache.delete(cacheKey);
    throw err;
  }
}

/** Test/HMR hook. */
export function clearChartCache(): void {
  chartCache.clear();
}
