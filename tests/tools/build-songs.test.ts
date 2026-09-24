import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SongIndex, SongMeta } from '../../src/app/types.ts';
import { chartHash } from '../../src/core/hash.ts';
import type { Chart } from '../../src/core/types.ts';
import { DARK, hexToRgb } from '../../src/design/tokens.ts';
import { JACKET_NAMES, dedupeHitObjects, discoverCharts, extractPalette, findJacket, levelFor, starsFor } from '../../tools/build-songs.ts';
import { patternEvents, renderOsu } from '../../tools/gen-fixture.ts';
import { jacketSvg, renderJacketPng } from '../../tools/gen-fixture.ts';
import { hash8 } from '../../tools/lib/fsx.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SONGS_DIR = join(ROOT, 'public', 'songs');

/** Every song the committed index lists; the tests below run over all of them. */
async function committedSongs(): Promise<{ index: SongIndex; songs: { dir: string; meta: SongMeta }[] }> {
  const index = JSON.parse(await readFile(join(SONGS_DIR, 'index.json'), 'utf8')) as SongIndex;
  const songs = await Promise.all(
    index.songs.map(async (s) => ({
      dir: join(SONGS_DIR, s.id),
      meta: JSON.parse(await readFile(join(SONGS_DIR, s.id, 'meta.json'), 'utf8')) as SongMeta,
    })),
  );
  return { index, songs };
}

const distance = (a: string, b: string): number => {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
};

describe('extractPalette', () => {
  it('is deterministic, returns three distinct hex colours, and ranks the jacket colours by area', async () => {
    // The synthetic fixture jacket: a big don brick and a kat chevron on ground.
    const png = await renderJacketPng(jacketSvg());
    const a = await extractPalette(png);
    const b = await extractPalette(png);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    for (const hex of a) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    // the big don (widest shape) wins, the kat chevron is second; neither ground nor surface appear
    expect(distance(a[0]!, DARK.don)).toBeLessThan(8);
    expect(distance(a[1]!, DARK.kat)).toBeLessThan(12);
    for (const hex of a) {
      expect(distance(hex, DARK.ground)).toBeGreaterThan(64);
      expect(distance(hex, DARK.surface)).toBeGreaterThan(64);
    }
    expect(distance(a[0]!, a[1]!)).toBeGreaterThanOrEqual(64);
    expect(distance(a[1]!, a[2]!)).toBeGreaterThanOrEqual(64);
  });
});

describe('committed public/songs output', () => {
  it('index.json lists every song, sorted by id, each entry equal to its meta.json', async () => {
    const { index, songs } = await committedSongs();
    expect(index.version).toBe(1);
    expect(songs.length).toBeGreaterThan(0);
    const ids = index.songs.map((s) => s.id);
    expect(ids).toEqual([...ids].sort());
    const onDisk = (await readdir(SONGS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(ids).toEqual(onDisk.sort());
    for (const [i, { meta }] of songs.entries()) {
      expect(index.songs[i]).toEqual(meta);
      expect(Object.keys(meta)).toEqual(['id', 'title', 'artist', 'palette', 'audioOffset', 'durationMs', 'audio', 'jacket', 'jacketSm', 'charts']);
      expect(meta.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(meta.title).not.toBe('');
      expect(meta.durationMs).toBeGreaterThan(0);
      expect(meta.palette).toHaveLength(3);
    }
  });

  it('meta.json points at files whose names carry their own content hash', async () => {
    const { songs } = await committedSongs();
    for (const { dir, meta } of songs) {
      for (const [name, pattern] of [
        [meta.audio, /^audio\.([0-9a-f]{8})\.webm$/],
        [meta.jacket, /^jacket\.([0-9a-f]{8})\.avif$/],
        [meta.jacketSm, /^jacket-sm\.([0-9a-f]{8})\.avif$/],
      ] as const) {
        const match = pattern.exec(name);
        expect(match, name).not.toBeNull();
        const bytes = await readFile(join(dir, name));
        expect(hash8(bytes)).toBe(match![1]);
      }
      // WebM/Matroska EBML magic
      const audio = await readFile(join(dir, meta.audio));
      expect([...audio.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
      // AVIF: ISO BMFF 'ftyp' box with the avif brand
      const jacket = await readFile(join(dir, meta.jacket));
      expect(jacket.subarray(4, 12).toString('latin1')).toBe('ftypavif');
    }
  });

  it('charts sorted easy → normal → hard, each reference agreeing with its file and hash', async () => {
    const { songs } = await committedSongs();
    const order = ['easy', 'normal', 'hard'];
    for (const { dir, meta } of songs) {
      expect(meta.charts.length).toBeGreaterThan(0);
      const tiers = meta.charts.map((c) => c.tier);
      expect(tiers).toEqual([...tiers].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
      expect(new Set(tiers).size).toBe(tiers.length);
      for (const ref of meta.charts) {
        expect(ref.file).toBe(`chart.${ref.tier}.json`);
        const chart = JSON.parse(await readFile(join(dir, ref.file), 'utf8')) as Chart;
        const osu = await readFile(join(ROOT, 'songs-src', meta.id, `${ref.tier}.osu`), 'utf8');
        expect(ref).toEqual({
          tier: ref.tier,
          name: chart.meta.difficulty,
          file: ref.file,
          hash: chart.hash,
          od: chart.meta.od,
          bpm: chart.meta.bpm,
          notes: chart.notes.length,
          stars: starsFor(osu),
          level: levelFor(ref.stars),
        });
        expect(await chartHash(chart)).toBe(chart.hash);
        expect(ref.level).toBeGreaterThanOrEqual(1);
        expect(ref.level).toBeLessThanOrEqual(10);
        expect(chart.notes.length).toBeGreaterThan(0);
      }
      // the legacy single-chart file is gone
      await expect(stat(join(dir, 'chart.json'))).rejects.toThrow();
    }
  });

  it('levelFor: round(stars × 1.6), clamped to 1..10', () => {
    expect(levelFor(2)).toBe(3);
    expect(levelFor(2.11)).toBe(3);
    expect(levelFor(2.91)).toBe(5);
    expect(levelFor(4.51)).toBe(7);
    expect(levelFor(6)).toBe(10);
    expect(levelFor(9)).toBe(10);
    expect(levelFor(0.2)).toBe(1);
    expect(levelFor(Number.NaN)).toBe(1);
  });

  it('dedupeHitObjects drops repeats of a timestamp so stacked notes cannot inflate the rating', () => {
    const events = patternEvents();
    const clean = renderOsu(events, 'Hard');
    const [head, body] = clean.split('[HitObjects]\n') as [string, string];
    const first = body.split('\n')[0] as string;
    const stacked = `${head}[HitObjects]\n${first}\n${first}\n${body}`; // the first note three times over
    expect(stacked).not.toBe(clean);
    expect(starsFor(stacked)).toBe(starsFor(clean));
    expect(dedupeHitObjects('no objects here')).toBe('no objects here');
  });

  it('starsFor: rosu-pp taiko star rating, deterministic, 2 decimals, higher for the denser tier', () => {
    const events = patternEvents();
    const hard = renderOsu(events, 'Hard');
    const a = starsFor(hard);
    expect(a).toBe(starsFor(hard));
    expect(a).toBeGreaterThan(0);
    expect(Math.round(a * 100) / 100).toBe(a);
    const sparse = renderOsu(events.filter((_, i) => i % 3 === 0), 'Easy');
    expect(starsFor(sparse)).toBeLessThan(a);
  });

  describe('discoverCharts', () => {
    let dir = '';
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'dyad-songs-'));
      for (const name of ['hard.osu', 'easy.osu', 'normal.osu', 'notes.txt', 'song.json']) {
        await writeFile(join(dir, name), name.endsWith('.osu') ? 'osu file format v14\n[Metadata]\nVersion:x\n' : '{}');
      }
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('findJacket takes the first accepted jacket name, case-insensitively, and names the options otherwise', async () => {
      await expect(findJacket(dir)).rejects.toThrow(JACKET_NAMES.join(', '));
      await writeFile(join(dir, 'Jacket.WEBP'), 'x');
      expect(await findJacket(dir)).toBe('jacket.webp');
      await writeFile(join(dir, 'jacket.png'), 'x');
      expect(await findJacket(dir)).toBe('jacket.png');
    });

    it('finds <tier>.osu files in tier order and skips strangers', async () => {
      expect(await discoverCharts(dir)).toEqual([
        { tier: 'easy', osu: 'easy.osu', file: 'chart.easy.json' },
        { tier: 'normal', osu: 'normal.osu', file: 'chart.normal.json' },
        { tier: 'hard', osu: 'hard.osu', file: 'chart.hard.json' },
      ]);
    });
  });

  it('public/probe.webm exists and is a small WebM', async () => {
    const path = join(ROOT, 'public', 'probe.webm');
    const info = await stat(path);
    expect(info.size).toBeGreaterThan(1000);
    expect(info.size).toBeLessThan(20000);
    const bytes = await readFile(path);
    expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  });
});
