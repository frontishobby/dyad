import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chartHash } from '../../src/core/hash.ts';
import type { Chart } from '../../src/core/types.ts';
import {
  convertOsu,
  difficultyRange,
  osuMode,
  parseKeyValues,
  parseOsuSections,
  serializeChart,
  spinnerHits,
} from '../../tools/convert-osu.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Build a minimal taiko .osu from parts. */
function osu(opts: {
  timing?: readonly string[];
  objects?: readonly string[];
  difficulty?: readonly string[];
  metadata?: readonly string[];
  eol?: string;
}): string {
  const eol = opts.eol ?? '\n';
  return [
    'osu file format v14',
    '',
    '[General]',
    'AudioFilename: song.wav',
    'Mode: 1',
    '',
    '[Metadata]',
    ...(opts.metadata ?? ['Title:Unit', 'Artist:Test', 'Version:Oni']),
    '',
    '[Difficulty]',
    ...(opts.difficulty ?? ['HPDrainRate:6', 'OverallDifficulty:5', 'SliderMultiplier:1.4']),
    '',
    '[TimingPoints]',
    ...(opts.timing ?? ['0,400,4,1,0,100,1,0']),
    '',
    '[HitObjects]',
    ...(opts.objects ?? []),
    '',
  ].join(eol);
}

const circle = (t: number, hitSound: number, type = 1): string => `256,192,${t},${type},${hitSound},0:0:0:0:`;
const slider = (t: number, length: number, slides = 1, hitSound = 0, type = 2): string =>
  `256,192,${t},${type},${hitSound},L|${256 + length}:192,${slides},${length},0|0,0:0|0:0,0:0:0:0:`;
const spinner = (t: number, end: number, type = 12): string => `256,192,${t},${type},0,${end},0:0:0:0:`;

describe('parseOsuSections', () => {
  it('handles CRLF, BOM, comments, blank lines and text before the first section', () => {
    const text = '﻿osu file format v14\r\n\r\n// leading comment\r\n[General]\r\nMode: 1\r\n\r\n[HitObjects]\r\n// comment\r\n256,192,0,1,0,0:0:0:0:\r\n';
    const sections = parseOsuSections(text);
    expect([...sections.keys()]).toEqual(['general', 'hitobjects']);
    expect(sections.get('general')).toEqual(['Mode: 1']);
    expect(sections.get('hitobjects')).toEqual(['256,192,0,1,0,0:0:0:0:']);
  });

  it('parses key/value lines with or without a space after the colon', () => {
    const kv = parseKeyValues(['Title:Twin Pulse', 'Artist: DYAD ', 'Weird:a:b']);
    expect(kv.get('title')).toBe('Twin Pulse');
    expect(kv.get('artist')).toBe('DYAD');
    expect(kv.get('weird')).toBe('a:b');
  });

  it('reports the ruleset', () => {
    expect(osuMode(osu({}))).toBe(1);
    expect(osuMode('[General]\nMode: 0\n')).toBe(0);
    expect(osuMode('[Metadata]\nTitle:x\n')).toBeNull();
  });
});

describe('convertOsu — note rules', () => {
  it('maps whistle and clap to kat, everything else to don, finish to big', async () => {
    const chart = await convertOsu(
      osu({
        objects: [
          circle(0, 0), // don
          circle(400, 1), // normal sample bit only → don
          circle(800, 2), // whistle → kat
          circle(1200, 8), // clap → kat
          circle(1600, 4), // finish → big don
          circle(2000, 12), // clap + finish → big kat
          circle(2400, 6), // whistle + finish → big kat
          circle(2800, 14), // whistle + clap + finish → big kat
        ],
      }),
    );
    expect(chart.notes.map((n) => `${n.k}${n.big ? '!' : ''}`)).toEqual(['d', 'd', 'k', 'k', 'd!', 'k!', 'k!', 'k!']);
    expect(chart.notes.map((n) => n.t)).toEqual([0, 400, 800, 1200, 1600, 2000, 2400, 2800]);
    expect(chart.rolls).toEqual([]);
    expect(chart.spinners).toEqual([]);
  });

  it('ignores combo bits on the type field', async () => {
    const chart = await convertOsu(osu({ objects: [circle(0, 8, 5), circle(400, 0, 1 | 4 | 16 | 32 | 64)] }));
    expect(chart.notes).toEqual([
      { t: 0, k: 'k', big: false },
      { t: 400, k: 'd', big: false },
    ]);
  });

  it('rounds fractional times to integer ms', async () => {
    const chart = await convertOsu(
      osu({
        timing: ['0.4,400,4,1,0,100,1,0'],
        objects: ['256,192,1000.5,1,0,0:0:0:0:', '256,192,1400.49,1,0,0:0:0:0:', spinner(2000.6, 3000.4)],
      }),
    );
    expect(chart.timing[0]?.t).toBe(0);
    expect(chart.notes.map((n) => n.t)).toEqual([1001, 1400]);
    expect(chart.spinners[0]).toMatchObject({ t: 2001, end: 3000 });
    for (const n of chart.notes) expect(Number.isInteger(n.t)).toBe(true);
  });

  it('stable-sorts notes, rolls, spinners and timing by t', async () => {
    const chart = await convertOsu(
      osu({
        timing: ['4000,500,4,1,0,100,1,0', '0,400,4,1,0,100,1,0'],
        objects: [circle(800, 8), circle(0, 0), circle(800, 0), slider(2000, 140), spinner(6000, 7000), spinner(5000, 5500), slider(1000, 140)],
      }),
    );
    expect(chart.timing.map((p) => p.t)).toEqual([0, 4000]);
    // equal t keeps file order: kat (clap) before don
    expect(chart.notes).toEqual([
      { t: 0, k: 'd', big: false },
      { t: 800, k: 'k', big: false },
      { t: 800, k: 'd', big: false },
    ]);
    expect(chart.rolls.map((r) => r.t)).toEqual([1000, 2000]);
    expect(chart.spinners.map((s) => s.t)).toEqual([5000, 6000]);
  });
});

describe('convertOsu — rolls (sliders)', () => {
  it('computes drumroll length from pixelLength, repeats, SliderMultiplier, SV and beatLength', async () => {
    // beatLength 400, SM 1.4, SV 1: 140 px = 1 beat = 400 ms
    const one = await convertOsu(osu({ objects: [slider(1000, 140)] }));
    expect(one.rolls).toEqual([{ t: 1000, end: 1400, big: false }]);

    // repeats multiply the length
    const three = await convertOsu(osu({ objects: [slider(1000, 140, 3)] }));
    expect(three.rolls[0]).toEqual({ t: 1000, end: 2200, big: false });

    // inherited point −50 → SV 2.0 → half the duration
    const fast = await convertOsu(osu({ timing: ['0,400,4,1,0,100,1,0', '500,-50,4,1,0,100,0,0'], objects: [slider(1000, 140)] }));
    expect(fast.rolls[0]).toEqual({ t: 1000, end: 1200, big: false });

    // inherited point −200 → SV 0.5 → double the duration
    const slow = await convertOsu(osu({ timing: ['0,400,4,1,0,100,1,0', '500,-200,4,1,0,100,0,0'], objects: [slider(1000, 140)] }));
    expect(slow.rolls[0]).toEqual({ t: 1000, end: 1800, big: false });

    // SliderMultiplier scales the velocity
    const sm = await convertOsu(
      osu({ difficulty: ['OverallDifficulty:5', 'SliderMultiplier:2.8'], objects: [slider(1000, 140)] }),
    );
    expect(sm.rolls[0]).toEqual({ t: 1000, end: 1200, big: false });

    // a slower uninherited point changes beatLength
    const bpm = await convertOsu(osu({ timing: ['0,400,4,1,0,100,1,0', '900,800,4,1,0,100,1,0'], objects: [slider(1000, 140)] }));
    expect(bpm.rolls[0]).toEqual({ t: 1000, end: 1800, big: false });
  });

  it('uses the SV in force at the slider start, and an uninherited point resets SV to 1.0', async () => {
    const chart = await convertOsu(
      osu({
        timing: [
          '0,400,4,1,0,100,1,0',
          '500,-50,4,1,0,100,0,0', // SV 2 from 500
          '2000,400,4,1,0,100,1,0', // red line at 2000 resets SV to 1
          '3000,400,4,1,0,100,1,0',
          '3000,-200,4,1,0,100,0,0', // green at the same time as a red wins → SV 0.5
        ],
        objects: [slider(400, 140), slider(1000, 140), slider(2000, 140), slider(3000, 140)],
      }),
    );
    expect(chart.rolls.map((r) => r.end - r.t)).toEqual([400, 200, 400, 800]);
  });

  it('rounds the roll end to an integer and clamps extreme SV like osu!taiko', async () => {
    const chart = await convertOsu(
      osu({
        timing: ['0,333.3333333333333,4,1,0,100,1,0', '500,-1,4,1,0,100,0,0'],
        objects: [slider(1000, 100)],
      }),
    );
    // -1 clamps to -10 → SV 10: 100 / (1.4 × 100 × 10) × 333.33 = 23.809… → 24
    expect(chart.rolls[0]).toEqual({ t: 1000, end: 1024, big: false });
    expect(Number.isInteger(chart.rolls[0]!.end)).toBe(true);
  });

  it('marks finish sliders as big', async () => {
    const chart = await convertOsu(osu({ objects: [slider(0, 140, 1, 4), slider(1000, 140, 1, 8)] }));
    expect(chart.rolls.map((r) => r.big)).toEqual([true, false]);
  });
});

describe('convertOsu — spinners', () => {
  it('takes endTime from objectParams and computes hits from OD', async () => {
    const at = async (od: number): Promise<number> => {
      const chart = await convertOsu(
        osu({ difficulty: [`OverallDifficulty:${od}`], objects: [spinner(1000, 4000)] }),
      );
      expect(chart.spinners[0]).toMatchObject({ t: 1000, end: 4000 });
      return chart.spinners[0]!.hits;
    };
    // 3 s × ratio: od 0 → 3/s, od 5 → 5/s, od 10 → 7.5/s, od 7 → 6/s
    expect(await at(0)).toBe(9);
    expect(await at(5)).toBe(15);
    expect(await at(10)).toBe(22);
    expect(await at(7)).toBe(18);
  });

  it('never requires fewer than one hit and never ends before it starts', async () => {
    const chart = await convertOsu(osu({ objects: [spinner(1000, 1050), spinner(2000, 1500)] }));
    expect(chart.spinners).toEqual([
      { t: 1000, end: 1050, hits: 1 },
      { t: 2000, end: 2000, hits: 1 },
    ]);
  });

  it('difficultyRange and spinnerHits follow the lazer formulas', () => {
    expect(difficultyRange(5, 3, 5, 7.5)).toBe(5);
    expect(difficultyRange(2.5, 3, 5, 7.5)).toBe(4);
    expect(difficultyRange(7.5, 3, 5, 7.5)).toBe(6.25);
    expect(spinnerHits(2200, 5)).toBe(11);
    expect(spinnerHits(0, 5)).toBe(1);
  });
});

describe('convertOsu — timing and meta', () => {
  it('keeps only uninherited points in timing and derives the bpm range', async () => {
    const chart = await convertOsu(
      osu({
        timing: [
          '0,400,4,1,0,100,1,0', // 150 bpm
          '1000,-100,4,1,0,100,0,0', // inherited: not a timing point
          '2000,333.3333333333333,3,1,0,100,1,0', // 180 bpm, 3/4
          '4000,500,0,1,0,100,1,0', // 120 bpm, meter 0 → 4
        ],
      }),
    );
    expect(chart.timing).toEqual([
      { t: 0, beatLength: 400, meter: 4 },
      { t: 2000, beatLength: 333.3333333333333, meter: 3 },
      { t: 4000, beatLength: 500, meter: 4 },
    ]);
    expect(chart.meta.bpm).toEqual([120, 180]);
  });

  it('bpm range ignores segments shorter than MIN_BPM_SEGMENT_MS (generator blips), but never the last one', async () => {
    const chart = await convertOsu(
      osu({
        timing: [
          '0,352.941,4,1,0,100,1,0', // 170 bpm for 44 s
          '44000,289.855,4,1,0,100,1,0', // 207 bpm for 600 ms: a blip
          '44600,350.877,4,1,0,100,1,0', // 171 bpm to the end
        ],
      }),
    );
    expect(chart.timing).toHaveLength(3); // the blip stays in the timing (bar lines follow it)
    expect(chart.meta.bpm).toEqual([170, 171]);
    // Only short segments: everything counts rather than nothing.
    const short = await convertOsu(osu({ timing: ['0,400,4,1,0,100,1,0', '500,300,4,1,0,100,1,0', '1000,500,4,1,0,100,1,0'] }));
    expect(short.meta.bpm).toEqual([120, 120]); // the last segment alone qualifies
  });

  it('keeps the last of two uninherited points at the same time', async () => {
    const chart = await convertOsu(osu({ timing: ['0,400,4,1,0,100,1,0', '0,500,4,1,0,100,1,0'] }));
    expect(chart.timing).toEqual([{ t: 0, beatLength: 500, meter: 4 }]);
    expect(chart.meta.bpm).toEqual([120, 120]);
  });

  it('reads meta from [Metadata] and [Difficulty] with osu defaults when missing', async () => {
    const chart = await convertOsu(
      osu({ metadata: ['Title:Twin Pulse', 'Artist:DYAD', 'Version:Muzukashii'], difficulty: ['OverallDifficulty:4.5', 'HPDrainRate:6'] }),
    );
    expect(chart.meta).toEqual({ title: 'Twin Pulse', artist: 'DYAD', difficulty: 'Muzukashii', bpm: [150, 150], od: 4.5, hp: 6 });

    const bare = await convertOsu('[HitObjects]\n256,192,100,1,0,0:0:0:0:\n');
    expect(bare.meta).toEqual({ title: '', artist: '', difficulty: '', bpm: [0, 0], od: 5, hp: 5 });
    expect(bare.timing).toEqual([]);
    expect(bare.notes).toEqual([{ t: 100, k: 'd', big: false }]);
  });

  it('survives an empty file', async () => {
    const chart = await convertOsu('');
    expect(chart.notes).toEqual([]);
    expect(chart.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the body (not meta) with chartHash', async () => {
    const a = await convertOsu(osu({ objects: [circle(0, 0)], metadata: ['Title:A'] }));
    const b = await convertOsu(osu({ objects: [circle(0, 0)], metadata: ['Title:B'] }));
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(await chartHash(a));
    const c = await convertOsu(osu({ objects: [circle(0, 8)] }));
    expect(c.hash).not.toBe(a.hash);
  });
});

describe('serializeChart', () => {
  it('writes keys in Chart order with 2-space indent and a trailing newline, dropping extras', () => {
    const chart = {
      hash: 'abc',
      spinners: [{ hits: 3, end: 200, t: 100 }],
      rolls: [{ big: true, end: 50, t: 10 }],
      notes: [{ big: false, k: 'k', t: 0, extra: 1 }],
      timing: [{ meter: 4, beatLength: 400, t: 0 }],
      meta: { hp: 5, od: 5, bpm: [150, 150], difficulty: 'x', artist: 'a', title: 't' },
      version: 1,
    } as unknown as Chart;
    const text = serializeChart(chart);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toBe(
      `${JSON.stringify(
        {
          version: 1,
          meta: { title: 't', artist: 'a', difficulty: 'x', bpm: [150, 150], od: 5, hp: 5 },
          timing: [{ t: 0, beatLength: 400, meter: 4 }],
          notes: [{ t: 0, k: 'k', big: false }],
          rolls: [{ t: 10, end: 50, big: true }],
          spinners: [{ t: 100, end: 200, hits: 3 }],
          hash: 'abc',
        },
        null,
        2,
      )}\n`,
    );
    expect(text).not.toContain('extra');
  });
});

describe('determinism', () => {
  it('converts the same text to identical bytes twice, regardless of line endings', async () => {
    const lf = osu({ objects: [circle(0, 0), slider(400, 140), spinner(2000, 3000)] });
    const crlf = osu({ objects: [circle(0, 0), slider(400, 140), spinner(2000, 3000)], eol: '\r\n' });
    const a = serializeChart(await convertOsu(lf));
    const b = serializeChart(await convertOsu(lf));
    const c = serializeChart(await convertOsu(crlf));
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('reproduces every committed chart.<tier>.json byte for byte from its songs-src .osu', async () => {
    const srcRoot = join(ROOT, 'songs-src');
    const ids = (await readdir(srcRoot, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    let checked = 0;
    for (const id of ids) {
      for (const tier of ['easy', 'normal', 'hard']) {
        const osuPath = join(srcRoot, id, `${tier}.osu`);
        const jsonPath = join(ROOT, 'public', 'songs', id, `chart.${tier}.json`);
        const [source, committed] = await Promise.all([
          readFile(osuPath, 'utf8').catch(() => null),
          readFile(jsonPath, 'utf8').catch(() => null),
        ]);
        if (source === null) continue;
        expect(committed, `${id}/${tier}: run npm run songs:build`).not.toBeNull();
        const chart = await convertOsu(source);
        expect(serializeChart(chart), `${id}/${tier}`).toBe(committed);
        // and the committed file's hash matches its own body
        const parsed = JSON.parse(committed as string) as Chart;
        expect(parsed.hash).toBe(chart.hash);
        expect(await chartHash(parsed)).toBe(parsed.hash);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
