import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { convertOsu } from '../../tools/convert-osu.ts';
import {
  BAR_MS,
  BEAT_MS,
  LEAD_IN_MS,
  OD,
  PATTERN,
  SAMPLE_RATE,
  SLOT_MS,
  TOTAL_MS,
  TIER_VERSION,
  eventsByTier,
  generateFixture,
  jacketSvg,
  patternEvents,
  renderOsu,
  tierEvents,
} from '../../tools/gen-fixture.ts';
import { TIERS } from '../../src/app/types.ts';
import { hash8 } from '../../tools/lib/fsx.ts';
import { readWavInfo } from '../../tools/lib/wav.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** sha256 prefix of the generated song.wav: the audio must not drift when the pattern or tier split changes. */
const WAV_HASH8 = 'd79aa38d';

describe('patternEvents', () => {
  it('turns bar strings into timed events on the 16th grid', () => {
    const events = patternEvents(['d.k. .... D... ....', 'r~~~ .... s~~~ ~~..']);
    expect(events).toEqual([
      { kind: 'note', t: LEAD_IN_MS, k: 'd', big: false },
      { kind: 'note', t: LEAD_IN_MS + 2 * SLOT_MS, k: 'k', big: false },
      { kind: 'note', t: LEAD_IN_MS + 8 * SLOT_MS, k: 'd', big: true },
      { kind: 'roll', t: LEAD_IN_MS + BAR_MS, end: LEAD_IN_MS + BAR_MS + 4 * SLOT_MS, big: false },
      { kind: 'spinner', t: LEAD_IN_MS + BAR_MS + 8 * SLOT_MS, end: LEAD_IN_MS + BAR_MS + 14 * SLOT_MS },
    ]);
  });

  it('lets a roll continue across a bar line and flags stray continuations', () => {
    const events = patternEvents(['.... .... .... ..R~', '~~.. .... .... ....']);
    expect(events).toEqual([{ kind: 'roll', t: LEAD_IN_MS + 14 * SLOT_MS, end: LEAD_IN_MS + 18 * SLOT_MS, big: true }]);
    expect(() => patternEvents(['~... .... .... ....'])).toThrow(/continues nothing/);
    expect(() => patternEvents(['d... ....'])).toThrow(/slots/);
    expect(() => patternEvents(['x... .... .... ....'])).toThrow(/unknown symbol/);
  });

  it('the shipped pattern has the promised shape', () => {
    const events = patternEvents(PATTERN);
    const notes = events.filter((e) => e.kind === 'note');
    const rolls = events.filter((e) => e.kind === 'roll');
    const spinners = events.filter((e) => e.kind === 'spinner');
    expect(notes.length).toBeGreaterThan(200);
    expect(notes.filter((n) => n.kind === 'note' && n.big).length).toBeGreaterThanOrEqual(6);
    expect(notes.some((n) => n.kind === 'note' && n.k === 'd')).toBe(true);
    expect(notes.some((n) => n.kind === 'note' && n.k === 'k')).toBe(true);
    expect(rolls).toHaveLength(2);
    expect(rolls.some((r) => r.kind === 'roll' && r.big)).toBe(true);
    expect(spinners).toHaveLength(1);
    // the spinner is near the end
    expect(spinners[0]!.t).toBeGreaterThan(TOTAL_MS * 0.9);
    // every time is an integer on the 16th grid, and the first note sits after the lead-in
    for (const e of events) {
      expect(Number.isInteger(e.t)).toBe(true);
      expect((e.t - LEAD_IN_MS) % SLOT_MS).toBe(0);
      expect(e.t).toBeGreaterThanOrEqual(LEAD_IN_MS);
    }
    // there are genuine 16th-note pairs (adjacent slots)
    const times = notes.map((n) => n.t);
    expect(times.some((t, i) => i > 0 && t - times[i - 1]! === SLOT_MS)).toBe(true);
    // sorted, and nothing after the song ends
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(Math.max(...events.map((e) => ('end' in e ? e.end : e.t)))).toBeLessThanOrEqual(TOTAL_MS);
  });
});

describe('generateFixture', () => {
  it('is deterministic: two runs give identical .osu text and WAV bytes', () => {
    const a = generateFixture();
    const b = generateFixture();
    expect(a.osu).toEqual(b.osu);
    expect(a.songJson).toBe(b.songJson);
    expect(a.jacketSvg).toBe(b.jacketSvg);
    expect(a.wav.length).toBe(b.wav.length);
    expect(Buffer.compare(Buffer.from(a.wav), Buffer.from(b.wav))).toBe(0);
  });

  it('writes a 44100 Hz 16-bit stereo WAV covering the whole song with a silent lead-in', () => {
    const { wav } = generateFixture();
    const info = readWavInfo(wav);
    expect(info).toMatchObject({ sampleRate: SAMPLE_RATE, channels: 2, bitsPerSample: 16 });
    expect(info.frames).toBe(Math.ceil((TOTAL_MS / 1000) * SAMPLE_RATE));
    expect(wav.length).toBe(info.dataOffset + info.dataBytes);

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const sample = (frame: number, channel: number): number => view.getInt16(info.dataOffset + (frame * 2 + channel) * 2, true);
    // lead-in is silent
    const leadFrames = Math.floor((LEAD_IN_MS / 1000) * SAMPLE_RATE);
    for (let f = 0; f < leadFrames; f += 997) {
      expect(sample(f, 0)).toBe(0);
      expect(sample(f, 1)).toBe(0);
    }
    // the first don at LEAD_IN_MS is audible within its first 20 ms
    let peak = 0;
    for (let f = leadFrames; f < leadFrames + SAMPLE_RATE * 0.02; f++) peak = Math.max(peak, Math.abs(sample(f, 0)));
    expect(peak).toBeGreaterThan(8000);
    // normalised: loud but never clipping
    let max = 0;
    for (let f = 0; f < info.frames; f += 7) max = Math.max(max, Math.abs(sample(f, 0)), Math.abs(sample(f, 1)));
    expect(max).toBeGreaterThan(20000);
    expect(max).toBeLessThanOrEqual(32767);
  });

  it('each tier .osu converts to the events it was rendered from', async () => {
    const { osu, eventsByTier: byTier, events } = generateFixture();
    expect(byTier.hard).toEqual(events);
    for (const tier of TIERS) {
      const chart = await convertOsu(osu[tier]);
      const tierEv = byTier[tier];
      expect(chart.meta).toEqual({ title: 'Twin Pulse', artist: 'DYAD', difficulty: TIER_VERSION[tier], bpm: [150, 150], od: OD, hp: 5 });
      expect(chart.timing).toEqual([{ t: LEAD_IN_MS, beatLength: BEAT_MS, meter: 4 }]);
      expect(chart.notes).toEqual(tierEv.filter((e) => e.kind === 'note').map((e) => ({ t: e.t, k: e.k, big: e.big })));
      expect(chart.rolls).toEqual(tierEv.filter((e) => e.kind === 'roll').map((e) => ({ t: e.t, end: e.end, big: e.big })));
      expect(chart.spinners.map((s) => ({ t: s.t, end: s.end }))).toEqual(
        tierEv.filter((e) => e.kind === 'spinner').map((e) => ({ t: e.t, end: e.end })),
      );
    }
  });

  it('easy ⊂ normal ⊂ hard by note time and type, so the audio has a hit under every note', () => {
    const byTier = eventsByTier();
    const key = (e: { t: number; k: string; big: boolean }) => `${e.t}:${e.k}:${e.big}`;
    const hardNotes = new Set(byTier.hard.filter((e) => e.kind === 'note').map((e) => key(e as never)));
    const hardRollStarts = new Set(byTier.hard.filter((e) => e.kind === 'roll').map((e) => e.t));
    const normalNotes = byTier.normal.filter((e) => e.kind === 'note');
    const easyNotes = byTier.easy.filter((e) => e.kind === 'note');
    for (const n of normalNotes) expect(hardNotes.has(key(n as never))).toBe(true);
    for (const n of easyNotes) {
      // an easy note is a hard note, or the don that replaced a roll at its start
      const asNote = n as { t: number; k: string; big: boolean };
      expect(hardNotes.has(key(asNote)) || (hardRollStarts.has(asNote.t) && asNote.k === 'd' && !asNote.big)).toBe(true);
    }
    expect(easyNotes.length).toBeLessThan(normalNotes.length);
    expect(normalNotes.length).toBeLessThan(byTier.hard.filter((e) => e.kind === 'note').length);
    // no off-beat 16ths in normal, quarters only in easy
    for (const n of normalNotes) expect(((n.t - LEAD_IN_MS) / SLOT_MS) % 2).toBe(0);
    for (const n of easyNotes) expect(((n.t - LEAD_IN_MS) / SLOT_MS) % 4).toBe(0);
    // easy: no rolls or spinners, big notes kept
    expect(byTier.easy.some((e) => e.kind !== 'note')).toBe(false);
    expect(easyNotes.filter((e) => e.kind === 'note' && e.big).length).toBe(
      byTier.hard.filter((e) => e.kind === 'note' && e.big).length,
    );
    // normal keeps the rolls and the spinner
    expect(byTier.normal.filter((e) => e.kind === 'roll')).toHaveLength(2);
    expect(byTier.normal.filter((e) => e.kind === 'spinner')).toHaveLength(1);
    // tierEvents never mutates its input
    const before = JSON.stringify(byTier.hard);
    tierEvents(byTier.hard, 'easy');
    expect(JSON.stringify(byTier.hard)).toBe(before);
  });

  it('renders osu v14 with taiko mode and LF line endings', () => {
    const text = renderOsu(patternEvents(['d... .... .... ....']));
    expect(text.startsWith('osu file format v14\n')).toBe(true);
    expect(text).toContain('\nMode: 1\n');
    expect(text).not.toContain('\r');
    expect(text.endsWith(`256,192,${LEAD_IN_MS},1,0,0:0:0:0:\n`)).toBe(true);
  });

  it('the jacket uses only token colours', async () => {
    const { DARK } = await import('../../src/design/tokens.ts');
    const svg = jacketSvg(DARK);
    const allowed = new Set(Object.values(DARK).filter((v): v is string => typeof v === 'string' && v.startsWith('#')));
    for (const hex of svg.match(/#[0-9A-Fa-f]{6}/g) ?? []) expect(allowed.has(hex)).toBe(true);
    expect(svg).toContain(DARK.don);
    expect(svg).toContain(DARK.kat);
  });

  it('the WAV is unchanged by the tier split', () => {
    const { wav } = generateFixture();
    expect(hash8(wav)).toBe(WAV_HASH8);
  });
});
