import { afterEach, describe, expect, it, vi } from 'vitest';
import { chartHash } from '../../src/core/hash.ts';
import type { Chart } from '../../src/core/types.ts';
import { clearChartCache, isSongIndex, loadChart, loadSongIndex, songUrl, songsBase } from '../../src/app/songs.ts';
import type { SongChartRef, SongMeta } from '../../src/app/types.ts';

function song(over: Partial<SongMeta> = {}): SongMeta {
  return {
    id: 'twin-pulse',
    title: 'Twin Pulse',
    artist: 'DYAD',
    palette: ['#123456'],
    audioOffset: 0,
    durationMs: 72800,
    previewMs: 20000,
    audio: 'audio.abc.webm',
    jacket: 'jacket.abc.avif',
    jacketSm: 'jacket-sm.abc.avif',
    charts: [],
    ...over,
  };
}

async function chart(): Promise<Chart> {
  const body = {
    timing: [{ t: 0, beatLength: 500, meter: 4 }],
    notes: [
      { t: 0, k: 'd' as const, big: false },
      { t: 500, k: 'k' as const, big: true },
    ],
    rolls: [],
    spinners: [],
  };
  return {
    version: 1,
    meta: { title: 'Twin Pulse', artist: 'DYAD', difficulty: 'Oni', bpm: [120, 120], od: 5, hp: 5 },
    ...body,
    hash: await chartHash(body),
  };
}

function ref(c: Chart, over: Partial<SongChartRef> = {}): SongChartRef {
  return { tier: 'hard', name: 'Oni', file: 'chart.hard.json', hash: c.hash, od: 5, bpm: [120, 120], notes: 2, stars: 4.5, level: 7, ...over };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearChartCache();
});

describe('songUrl', () => {
  it('joins base, songs/, the id and the file', () => {
    const base = songsBase();
    expect(base.endsWith('songs/')).toBe(true);
    expect(base.includes('//songs')).toBe(false);
    expect(songUrl(song(), 'chart.hard.json')).toBe(`${base}twin-pulse/chart.hard.json`);
    expect(songUrl(song({ id: 'a b' }), 'x')).toBe(`${base}a%20b/x`);
  });
});

describe('loadSongIndex', () => {
  it('returns a valid index with charts in tier order', async () => {
    const c = await chart();
    const hard = ref(c);
    const easy = ref(c, { tier: 'easy', name: 'Easy', file: 'chart.easy.json', stars: 2, level: 3 });
    const index = { version: 1, songs: [song({ charts: [hard, easy] })] };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe(`${songsBase()}index.json`);
      return jsonResponse(index);
    }));
    const loaded = await loadSongIndex();
    expect(loaded.songs[0]?.charts.map((r) => r.tier)).toEqual(['easy', 'hard']);
    expect(loaded.songs[0]?.charts).toEqual([easy, hard]);
  });

  it('rejects HTTP errors and bad shapes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 404)));
    await expect(loadSongIndex()).rejects.toThrow(/404/);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ version: 2, songs: [] })));
    await expect(loadSongIndex()).rejects.toThrow(/shape/);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ version: 1, songs: [{ id: 'x' }] })));
    await expect(loadSongIndex()).rejects.toThrow(/shape/);
  });

  it('validates chart refs inside songs', () => {
    expect(isSongIndex({ version: 1, songs: [] })).toBe(true);
    const c: SongChartRef = { tier: 'normal', name: 'Normal', file: 'chart.normal.json', hash: 'h', od: 5, bpm: [1, 2], notes: 3, stars: 3.1, level: 5 };
    expect(isSongIndex({ version: 1, songs: [song({ charts: [c] })] })).toBe(true);
    expect(isSongIndex({ version: 1, songs: [song({ charts: [{ ...c, hash: '' }] })] })).toBe(false);
    expect(isSongIndex({ version: 1, songs: [song({ charts: [{ ...c, tier: 'oni' as never }] })] })).toBe(false);
    const { durationMs: _drop, ...noDuration } = song();
    void _drop;
    expect(isSongIndex({ version: 1, songs: [noDuration] })).toBe(false);
  });
});

describe('loadChart', () => {
  it('resolves when the index hash, the declared hash and the computed hash agree', async () => {
    const c = await chart();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(c)));
    const loaded = await loadChart(song(), ref(c));
    expect(loaded).toEqual(c);
  });

  it('rejects when the file hash differs from the index', async () => {
    const c = await chart();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(c)));
    await expect(loadChart(song(), ref(c, { hash: 'f'.repeat(64) }))).rejects.toThrow(/hash mismatch/);
  });

  it('rejects when the body does not hash to the declared hash', async () => {
    const c = await chart();
    const tampered: Chart = { ...c, notes: [...c.notes, { t: 1000, k: 'd', big: false }] };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(tampered)));
    await expect(loadChart(song(), ref(c))).rejects.toThrow(/computed/);
  });

  it('rejects HTTP errors and malformed files', async () => {
    const c = await chart();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null, 500)));
    await expect(loadChart(song(), ref(c))).rejects.toThrow(/500/);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ version: 1 })));
    await expect(loadChart(song(), ref(c))).rejects.toThrow(/shape/);
  });

  it('caches successful loads per url+hash and retries after a failure', async () => {
    const c = await chart();
    const fetchMock = vi.fn(async () => jsonResponse(c));
    vi.stubGlobal('fetch', fetchMock);
    await loadChart(song(), ref(c));
    await loadChart(song(), ref(c));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clearChartCache();
    const failing = vi.fn(async () => jsonResponse(null, 500));
    vi.stubGlobal('fetch', failing);
    await expect(loadChart(song(), ref(c))).rejects.toThrow();
    vi.stubGlobal('fetch', fetchMock);
    await loadChart(song(), ref(c));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
